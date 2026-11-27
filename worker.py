#!/usr/bin/env python3
"""JetPack AI Photo Studio Worker (dev.codingbro.ai-photo-studio)."""

from __future__ import annotations

import io
import json
import os
import struct
import sys
import threading
import uuid
from typing import Any, Dict, List, Literal, Optional, Tuple

# Allow importing jetpack_sdk both from installed venv and monorepo dev checkout
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_SDK_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "../../jetpack/sdks/python"))
if os.path.isdir(REPO_SDK_DIR) and REPO_SDK_DIR not in sys.path:
    sys.path.insert(0, REPO_SDK_DIR)

try:
    import msgpack as _msgpack  # type: ignore
except ImportError:  # pragma: no cover - fallback used in minimal host unit tests
    _msgpack = None

try:
    from pydantic import BaseModel
except ImportError:  # pragma: no cover - fallback when pydantic is absent on host test env
    class BaseModel:  # type: ignore[no-redef]
        def __init__(self, **data: Any) -> None:
            for k, v in data.items():
                setattr(self, k, v)

        def model_dump(self) -> Dict[str, Any]:
            return dict(self.__dict__)

from jetpack_sdk import JetPackClient, opcode
from pipeline import (
    PipelineError,
    StudioFileRecord,
    StudioPipeline,
    get_onnx_providers,
    get_torch_device,
)


# ---------------------------------------------------------------------------
# Typed Opcode Metadata & Response Contracts (inspected by `jetpack codegen`)
# ---------------------------------------------------------------------------


class StudioFileEntry(BaseModel):
    filename: str
    stem: str
    extension: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    modified_ms: int
    is_processed: bool
    output_filename: Optional[str] = None
    output_mime_type: Optional[str] = None
    output_size_bytes: Optional[int] = None
    output_width: Optional[int] = None
    output_height: Optional[int] = None
    thumb_offset: int
    thumb_length: int
    thumb_mime: str
    dpi_x: Optional[float] = None
    dpi_y: Optional[float] = None
    color_mode: Optional[str] = None
    source: str = "workspace"
    output_dpi_x: Optional[float] = None
    output_dpi_y: Optional[float] = None
    output_color_mode: Optional[str] = None


class StudioListFilesResult(BaseModel):
    working_dir: str
    processed_count: int
    accelerator: str
    onnx_providers: List[str]
    files: List[StudioFileEntry]


class StudioUploadMeta(BaseModel):
    filename: str
    overwrite: bool = True


class StudioUploadResult(BaseModel):
    file: StudioFileEntry
    working_dir: str


class StudioGetImageMeta(BaseModel):
    filename: str
    variant: Literal["original", "output", "both"] = "both"


class StudioGetImageResult(BaseModel):
    filename: str
    is_processed: bool
    original_mime: str
    original_offset: int
    original_length: int
    output_filename: Optional[str] = None
    output_mime: Optional[str] = None
    output_offset: int
    output_length: int


class StudioProcessParams(BaseModel):
    scale: Optional[int] = None
    bg_mode: Optional[Literal["transparent", "color"]] = None
    bg_color: Optional[str] = None
    level: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    keep_aspect: Optional[bool] = None
    fit_mode: Optional[Literal["contain", "cover", "stretch"]] = None
    crop_mode: Optional[Literal["keep_aspect", "ratio", "custom"]] = None
    crop_x: Optional[float] = None
    crop_y: Optional[float] = None
    crop_w: Optional[float] = None
    crop_h: Optional[float] = None


class StudioProcessMeta(BaseModel):
    filenames: List[str]
    tool: Literal["upscale", "enhance", "remove_bg", "blur_bg", "crop", "resize"]
    params: Optional[StudioProcessParams] = None
    output_format: Literal["auto", "png", "jpg", "webp"] = "auto"
    job_id: Optional[str] = None


class StudioProcessProgress(BaseModel):
    job_id: str
    filename: str
    index: int
    total: int
    percent: float
    stage: str


class StudioProcessResult(BaseModel):
    job_id: str
    processed_files: List[StudioFileEntry]
    processed_count: int


class StudioRestoreMeta(BaseModel):
    filename: Optional[str] = None
    restore_all: bool = False


class StudioRestoreResult(BaseModel):
    restored_count: int
    processed_count: int


class StudioDownloadZipResult(BaseModel):
    filename: str
    file_count: int
    total_bytes: int


class StudioOpenFolderResult(BaseModel):
    opened: bool
    path: str
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Zero-Copy Frame Payload Codecs
# ---------------------------------------------------------------------------


def _unpack_msgpack_stream(stream: io.BytesIO) -> Any:
    b = stream.read(1)
    if not b:
        raise EOFError("Unexpected end of MsgPack payload")
    byte = b[0]

    if byte <= 0x7F:
        return byte
    if 0x80 <= byte <= 0x8F:
        count = byte & 0x0F
        return {str(_unpack_msgpack_stream(stream)): _unpack_msgpack_stream(stream) for _ in range(count)}
    if 0x90 <= byte <= 0x9F:
        count = byte & 0x0F
        return [_unpack_msgpack_stream(stream) for _ in range(count)]
    if 0xA0 <= byte <= 0xBF:
        length = byte & 0x1F
        return stream.read(length).decode("utf-8", errors="replace")
    if byte >= 0xE0:
        return struct.unpack("b", bytes([byte]))[0]

    if byte == 0xC0:
        return None
    if byte == 0xC2:
        return False
    if byte == 0xC3:
        return True
    if byte == 0xC4:
        n = struct.unpack("B", stream.read(1))[0]
        return stream.read(n)
    if byte == 0xC5:
        n = struct.unpack(">H", stream.read(2))[0]
        return stream.read(n)
    if byte == 0xC6:
        n = struct.unpack(">I", stream.read(4))[0]
        return stream.read(n)
    if byte == 0xCA:
        return struct.unpack(">f", stream.read(4))[0]
    if byte == 0xCB:
        return struct.unpack(">d", stream.read(8))[0]
    if byte == 0xCC:
        return struct.unpack("B", stream.read(1))[0]
    if byte == 0xCD:
        return struct.unpack(">H", stream.read(2))[0]
    if byte == 0xCE:
        return struct.unpack(">I", stream.read(4))[0]
    if byte == 0xCF:
        return struct.unpack(">Q", stream.read(8))[0]
    if byte == 0xD0:
        return struct.unpack("b", stream.read(1))[0]
    if byte == 0xD1:
        return struct.unpack(">h", stream.read(2))[0]
    if byte == 0xD2:
        return struct.unpack(">i", stream.read(4))[0]
    if byte == 0xD3:
        return struct.unpack(">q", stream.read(8))[0]
    if byte == 0xD9:
        n = struct.unpack("B", stream.read(1))[0]
        return stream.read(n).decode("utf-8", errors="replace")
    if byte == 0xDA:
        n = struct.unpack(">H", stream.read(2))[0]
        return stream.read(n).decode("utf-8", errors="replace")
    if byte == 0xDB:
        n = struct.unpack(">I", stream.read(4))[0]
        return stream.read(n).decode("utf-8", errors="replace")
    if byte == 0xDC:
        n = struct.unpack(">H", stream.read(2))[0]
        return [_unpack_msgpack_stream(stream) for _ in range(n)]
    if byte == 0xDD:
        n = struct.unpack(">I", stream.read(4))[0]
        return [_unpack_msgpack_stream(stream) for _ in range(n)]
    if byte == 0xDE:
        n = struct.unpack(">H", stream.read(2))[0]
        return {str(_unpack_msgpack_stream(stream)): _unpack_msgpack_stream(stream) for _ in range(n)}
    if byte == 0xDF:
        n = struct.unpack(">I", stream.read(4))[0]
        return {str(_unpack_msgpack_stream(stream)): _unpack_msgpack_stream(stream) for _ in range(n)}

    raise ValueError(f"Unsupported MsgPack tag byte: 0x{byte:02x}")


def decode_request_payload(raw_payload: bytes | memoryview) -> Tuple[Dict[str, Any], memoryview]:
    """Splits a worker hybrid payload into MsgPack metadata dict + zero-copy memoryview."""
    mv = memoryview(raw_payload)
    if len(mv) == 0:
        return {}, mv

    if _msgpack is not None:
        unpacker = _msgpack.Unpacker(raw=False)
        unpacker.feed(mv)
        meta_obj = unpacker.unpack()
        offset = unpacker.tell()
    else:
        stream = io.BytesIO(mv)
        meta_obj = _unpack_msgpack_stream(stream)
        offset = stream.tell()

    if meta_obj is None:
        return {}, mv[offset:]
    if not isinstance(meta_obj, dict):
        raise ValueError("Expected MsgPack map for request metadata.")
    return meta_obj, mv[offset:]


def encode_envelope(meta: Dict[str, Any], binary_payload: bytes | bytearray | memoryview = b"") -> bytes:
    """Encodes `[4-byte LE meta_len] + [UTF-8 JSON meta] + [raw binary bytes]`."""
    meta_bytes = json.dumps(meta, separators=(",", ":")).encode("utf-8")
    header = struct.pack("<I", len(meta_bytes))
    if not binary_payload:
        return header + meta_bytes
    return header + meta_bytes + bytes(binary_payload)


def pack_records_with_thumbnails(records: List[StudioFileRecord]) -> Tuple[List[Dict[str, Any]], bytes]:
    """Packs file metadata alongside concatenated thumbnail bytes for zero-copy slicing."""
    entries: List[Dict[str, Any]] = []
    thumb_buf = bytearray()
    for rec in records:
        offset = len(thumb_buf)
        length = len(rec.thumbnail_bytes)
        thumb_buf.extend(rec.thumbnail_bytes)
        entries.append(rec.to_metadata_dict(offset, length))
    return entries, bytes(thumb_buf)


# ---------------------------------------------------------------------------
# Worker Application Controller
# ---------------------------------------------------------------------------


class PhotoStudioWorker:
    def __init__(self, client: Any, pipeline: Optional[StudioPipeline] = None) -> None:
        self.client = client
        self.pipeline = pipeline or StudioPipeline()
        self.accelerator = get_torch_device()
        self.onnx_providers = get_onnx_providers()
        self._send_lock = threading.Lock()

    def _send_frame(
        self,
        *,
        opcode: str,
        payload: bytes = b"",
        channel_id: int = 0,
        correlation_id: Optional[int] = None,
    ) -> None:
        with self._send_lock:
            self.client.send_frame(
                opcode=opcode,
                payload=payload,
                channel_id=channel_id,
                correlation_id=correlation_id,
            )

    def send_error(self, channel_id: int, correlation_id: Optional[int], message: str) -> None:
        print(f"[PhotoStudio] Error: {message}", file=sys.stderr, flush=True)
        payload = json.dumps({"error": message}).encode("utf-8")
        self._send_frame(
            opcode="system.error",
            payload=payload,
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.list_files", request=None, response=StudioListFilesResult, binary=False)
    def handle_list_files(self, channel_id: int, correlation_id: Optional[int]) -> None:
        records = self.pipeline.list_files()
        entries, thumb_bytes = pack_records_with_thumbnails(records)
        processed_count = sum(1 for r in records if r.is_processed)
        meta = {
            "working_dir": str(self.pipeline.working_dir),
            "processed_count": processed_count,
            "accelerator": self.accelerator,
            "onnx_providers": self.onnx_providers,
            "files": entries,
        }
        self._send_frame(
            opcode="studio.list_files.ok",
            payload=encode_envelope(meta, thumb_bytes),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.upload_files", request=StudioUploadMeta, response=StudioUploadResult, binary=True)
    def handle_upload_files(
        self,
        channel_id: int,
        correlation_id: Optional[int],
        raw_payload: bytes,
    ) -> None:
        meta, binary_mv = decode_request_payload(raw_payload)
        filename = str(meta.get("filename") or "")
        overwrite = bool(meta.get("overwrite", True))
        record = self.pipeline.save_uploaded_file(filename, binary_mv, overwrite=overwrite)
        resp_meta = {
            "file": record.to_metadata_dict(0, len(record.thumbnail_bytes)),
            "working_dir": str(self.pipeline.working_dir),
        }
        self._send_frame(
            opcode="studio.upload_files.ok",
            payload=encode_envelope(resp_meta, record.thumbnail_bytes),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.get_image", request=StudioGetImageMeta, response=StudioGetImageResult, binary=False)
    def handle_get_image(
        self,
        channel_id: int,
        correlation_id: Optional[int],
        raw_payload: bytes,
    ) -> None:
        meta, _ = decode_request_payload(raw_payload)
        filename = str(meta.get("filename") or "")
        variant = str(meta.get("variant") or "both")
        if variant not in ("original", "output", "both"):
            raise PipelineError(f"Invalid image variant '{variant}'.")

        data = self.pipeline.get_image_bytes(filename, variant=variant)
        orig_bytes: bytes = data["original_bytes"]
        out_bytes: bytes = data["output_bytes"]
        combined = orig_bytes + out_bytes
        resp_meta = {
            "filename": data["filename"],
            "is_processed": data["is_processed"],
            "original_mime": data["original_mime"],
            "original_offset": 0,
            "original_length": len(orig_bytes),
            "output_filename": data["output_filename"],
            "output_mime": data["output_mime"],
            "output_offset": len(orig_bytes),
            "output_length": len(out_bytes),
        }
        self._send_frame(
            opcode="studio.get_image.ok",
            payload=encode_envelope(resp_meta, combined),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.process.progress", request=None, response=StudioProcessProgress, binary=False, stream=True)
    def emit_process_progress(
        self,
        channel_id: int,
        job_id: str,
        filename: str,
        index: int,
        total: int,
        percent: float,
        stage: str,
    ) -> None:
        # Unsolicited stream frame (correlation_id=None) so unary request waits for studio.process.ok
        self._send_frame(
            opcode="studio.process.progress",
            payload=encode_envelope(
                {
                    "job_id": job_id,
                    "filename": filename,
                    "index": index,
                    "total": total,
                    "percent": round(float(percent), 2),
                    "stage": stage,
                }
            ),
            channel_id=channel_id,
            correlation_id=None,
        )

    @opcode("studio.process", request=StudioProcessMeta, response=StudioProcessResult, binary=False)
    def handle_process(
        self,
        channel_id: int,
        correlation_id: Optional[int],
        raw_payload: bytes,
        *,
        async_exec: bool = True,
    ) -> None:
        meta, _ = decode_request_payload(raw_payload)
        filenames = [str(f) for f in (meta.get("filenames") or [])]
        tool = str(meta.get("tool") or "")
        params = dict(meta.get("params") or {})
        output_format = str(meta.get("output_format") or "auto")
        job_id = str(meta.get("job_id") or uuid.uuid4().hex)

        def _run_job() -> None:
            try:
                records = self.pipeline.process_batch(
                    filenames,
                    tool,
                    params=params,
                    output_format=output_format,
                    on_progress=lambda fname, idx, total, pct, stage: self.emit_process_progress(
                        channel_id, job_id, fname, idx, total, pct, stage
                    ),
                )
                entries, thumb_bytes = pack_records_with_thumbnails(records)
                all_files = self.pipeline.list_files()
                processed_count = sum(1 for r in all_files if r.is_processed)
                resp_meta = {
                    "job_id": job_id,
                    "processed_files": entries,
                    "processed_count": processed_count,
                }
                self._send_frame(
                    opcode="studio.process.ok",
                    payload=encode_envelope(resp_meta, thumb_bytes),
                    channel_id=channel_id,
                    correlation_id=correlation_id,
                )
            except Exception as exc:
                self.send_error(channel_id, correlation_id, str(exc))

        if async_exec:
            t = threading.Thread(target=_run_job, daemon=True, name=f"studio-job-{job_id[:8]}")
            t.start()
        else:
            _run_job()

    @opcode("studio.restore", request=StudioRestoreMeta, response=StudioRestoreResult, binary=False)
    def handle_restore(
        self,
        channel_id: int,
        correlation_id: Optional[int],
        raw_payload: bytes,
    ) -> None:
        meta, _ = decode_request_payload(raw_payload)
        restore_all = bool(meta.get("restore_all", False))
        filename = meta.get("filename")

        if restore_all:
            restored = self.pipeline.restore_all()
        elif filename:
            restored = 1 if self.pipeline.restore_file(str(filename)) else 0
        else:
            raise PipelineError("Specify 'filename' or set 'restore_all=true'.")

        all_files = self.pipeline.list_files()
        processed_count = sum(1 for r in all_files if r.is_processed)
        self._send_frame(
            opcode="studio.restore.ok",
            payload=encode_envelope(
                {
                    "restored_count": restored,
                    "processed_count": processed_count,
                }
            ),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.download_zip", request=None, response=StudioDownloadZipResult, binary=False)
    def handle_download_zip(self, channel_id: int, correlation_id: Optional[int]) -> None:
        zip_bytes, file_count = self.pipeline.create_output_zip()
        meta = {
            "filename": "ai-photo-studio-output.zip",
            "file_count": file_count,
            "total_bytes": len(zip_bytes),
        }
        self._send_frame(
            opcode="studio.download_zip.ok",
            payload=encode_envelope(meta, zip_bytes),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    @opcode("studio.open_folder", request=None, response=StudioOpenFolderResult, binary=False)
    def handle_open_folder(self, channel_id: int, correlation_id: Optional[int]) -> None:
        result = self.pipeline.open_working_dir()
        self._send_frame(
            opcode="studio.open_folder.ok",
            payload=encode_envelope(result),
            channel_id=channel_id,
            correlation_id=correlation_id,
        )

    def dispatch(self, frame: Any) -> bool:
        opcode_name = frame.opcode
        channel_id = frame.channel_id
        correlation_id = frame.correlation_id
        payload = frame.payload

        try:
            if opcode_name == "studio.list_files":
                self.handle_list_files(channel_id, correlation_id)
                return True

            if opcode_name == "studio.upload_files":
                self.handle_upload_files(channel_id, correlation_id, payload)
                return True

            if opcode_name == "studio.get_image":
                self.handle_get_image(channel_id, correlation_id, payload)
                return True

            if opcode_name == "studio.process":
                self.handle_process(channel_id, correlation_id, payload)
                return True

            if opcode_name == "studio.restore":
                self.handle_restore(channel_id, correlation_id, payload)
                return True

            if opcode_name == "studio.download_zip":
                self.handle_download_zip(channel_id, correlation_id)
                return True

            if opcode_name == "studio.open_folder":
                self.handle_open_folder(channel_id, correlation_id)
                return True

            if opcode_name in ("worker.ping", "app.ping"):
                self._send_frame(
                    opcode="worker.pong" if opcode_name == "worker.ping" else "app.pong",
                    payload=payload or b"pong",
                    channel_id=channel_id,
                    correlation_id=correlation_id,
                )
                return True

            if opcode_name in ("app.terminate", "worker.stop"):
                self._send_frame(
                    opcode="app.terminate.ok",
                    payload=b"ok",
                    channel_id=channel_id,
                    correlation_id=correlation_id,
                )
                return False

            self.send_error(channel_id, correlation_id, f"Unsupported opcode '{opcode_name}'")
            return True
        except Exception as exc:
            self.send_error(channel_id, correlation_id, str(exc))
            return True


def main() -> None:
    if "--standalone-test" in sys.argv:
        print("[dev.codingbro.ai-photo-studio] Standalone worker check OK", flush=True)
        return

    with JetPackClient() as client:
        worker = PhotoStudioWorker(client)
        print(
            f"[dev.codingbro.ai-photo-studio] Connected to JetPack daemon IPC "
            f"(working_dir={worker.pipeline.working_dir}, accelerator={worker.accelerator})",
            flush=True,
        )
        try:
            while True:
                frame = client.read_frame()
                if frame is None:
                    break
                if not worker.dispatch(frame):
                    break
        finally:
            worker.pipeline.close()


if __name__ == "__main__":
    main()
