"""Non-destructive AI & image processing pipeline for AI Photo Studio."""

from __future__ import annotations

import concurrent.futures
import io
import os
import re
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from PIL import Image, ImageFilter, ImageOps

SUPPORTED_EXTENSIONS: frozenset[str] = frozenset(
    {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"}
)

OUTPUT_FORMAT_EXTENSIONS: Dict[str, str] = {
    "png": "png",
    "jpg": "jpg",
    "jpeg": "jpg",
    "webp": "webp",
}

FORMAT_MIME_TYPES: Dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
}

SPANDREL_MODEL_SPECS: Dict[str, Dict[str, str]] = {
    "upscale_x2": {
        "filename": "RealESRGAN_x2plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
    },
    "upscale_x4": {
        "filename": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
    },
    "enhance_1x": {
        "filename": "1x-ITF-SkinDiffDetail-Lite-v1.pth",
        "url": "https://huggingface.co/uwg/upscaler/resolve/main/ESRGAN/1x-ITF-SkinDiffDetail-Lite-v1.pth",
    },
}

HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")
THUMBNAIL_MAX_SIZE = (240, 240)


class PipelineError(ValueError):
    """Domain error raised for invalid paths, formats, or processing options."""


@dataclass(frozen=True)
class StudioFileRecord:
    filename: str
    stem: str
    extension: str
    mime_type: str
    size_bytes: int
    width: int
    height: int
    modified_ms: int
    is_processed: bool
    output_filename: Optional[str]
    output_mime_type: Optional[str]
    output_size_bytes: Optional[int]
    output_width: Optional[int]
    output_height: Optional[int]
    thumbnail_bytes: bytes
    thumbnail_mime: str
    dpi_x: Optional[float] = None
    dpi_y: Optional[float] = None
    color_mode: Optional[str] = None
    source: str = "workspace"
    output_dpi_x: Optional[float] = None
    output_dpi_y: Optional[float] = None
    output_color_mode: Optional[str] = None

    def to_metadata_dict(self, thumb_offset: int, thumb_length: int) -> Dict[str, Any]:
        return {
            "filename": self.filename,
            "stem": self.stem,
            "extension": self.extension,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "width": self.width,
            "height": self.height,
            "modified_ms": self.modified_ms,
            "is_processed": self.is_processed,
            "output_filename": self.output_filename,
            "output_mime_type": self.output_mime_type,
            "output_size_bytes": self.output_size_bytes,
            "output_width": self.output_width,
            "output_height": self.output_height,
            "thumb_offset": thumb_offset,
            "thumb_length": thumb_length,
            "thumb_mime": self.thumbnail_mime,
            "dpi_x": self.dpi_x,
            "dpi_y": self.dpi_y,
            "color_mode": self.color_mode,
            "source": self.source,
            "output_dpi_x": self.output_dpi_x,
            "output_dpi_y": self.output_dpi_y,
            "output_color_mode": self.output_color_mode,
        }


def resolve_working_dir(working_dir: Optional[str | Path] = None) -> Path:
    """Resolves the working directory (JETPACK_APP_HOME by default)."""
    if working_dir is not None:
        base = Path(working_dir)
    else:
        raw = (
            os.environ.get("JETPACK_VOL_PROJECT_DIR")
            or os.environ.get("JETPACK_APP_HOME")
            or os.environ.get("APP_HOME")
            or ""
        ).strip()
        base = Path(raw) if raw else (Path.cwd() / "app_home")
    base.mkdir(parents=True, exist_ok=True)
    (base / "output").mkdir(parents=True, exist_ok=True)
    return base.resolve()


def configure_model_cache(
    working_dir: Path,
    model_cache_dir: Optional[str | Path] = None,
) -> Path:
    """Configures shared AI model, JIT, and temp directories inside JETPACK_MODEL_CACHE_DIR."""
    raw = (
        str(model_cache_dir)
        if model_cache_dir is not None
        else (os.environ.get("JETPACK_MODEL_CACHE_DIR") or "").strip()
    )
    cache_root = Path(raw) if raw else (working_dir / ".model_cache")
    hf_dir = cache_root / "huggingface"
    torch_dir = cache_root / "torch"
    u2net_dir = cache_root / "u2net"
    spandrel_dir = cache_root / "spandrel"
    numba_dir = cache_root / "numba"
    xdg_cache_dir = cache_root / "xdg_cache"
    xdg_data_dir = cache_root / "xdg_data"
    tmp_dir = cache_root / "tmp"
    for d in (
        cache_root,
        hf_dir,
        torch_dir,
        u2net_dir,
        spandrel_dir,
        numba_dir,
        xdg_cache_dir,
        xdg_data_dir,
        tmp_dir,
    ):
        d.mkdir(parents=True, exist_ok=True)

    os.environ["JETPACK_MODEL_CACHE_DIR"] = str(cache_root)
    os.environ.setdefault("HF_HOME", str(hf_dir))
    os.environ.setdefault("TORCH_HOME", str(torch_dir))
    os.environ["U2NET_HOME"] = str(u2net_dir)
    os.environ.setdefault("REMBG_HOME", str(u2net_dir))
    os.environ["NUMBA_CACHE_DIR"] = str(numba_dir)
    os.environ.setdefault("XDG_CACHE_HOME", str(xdg_cache_dir))
    os.environ.setdefault("XDG_DATA_HOME", str(xdg_data_dir))
    os.environ["TMPDIR"] = str(tmp_dir)
    os.environ["TEMP"] = str(tmp_dir)
    os.environ["TMP"] = str(tmp_dir)
    tempfile.tempdir = str(tmp_dir)
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

    try:
        import certifi  # type: ignore

        ca_bundle = certifi.where()
        if ca_bundle and os.path.isfile(ca_bundle):
            os.environ.setdefault("SSL_CERT_FILE", ca_bundle)
            os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_bundle)
    except Exception:
        pass

    numba_cfg = sys.modules.get("numba.core.config")
    if numba_cfg is not None and hasattr(numba_cfg, "reload_config"):
        try:
            numba_cfg.reload_config()
        except Exception:
            pass

    return cache_root


def _build_ssl_context() -> ssl.SSLContext:
    """Builds an SSLContext using certifi's CA bundle inside the .venv when available."""
    try:
        import certifi  # type: ignore

        ca_bundle = certifi.where()
        if ca_bundle and os.path.isfile(ca_bundle):
            return ssl.create_default_context(cafile=ca_bundle)
    except Exception:
        pass
    return ssl.create_default_context()


def get_torch_device() -> str:
    """Selects best available PyTorch accelerator: cuda -> mps -> cpu."""
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            return "cuda"
        mps_backend = getattr(torch.backends, "mps", None)
        if mps_backend is not None and mps_backend.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def get_onnx_providers() -> List[str]:
    """Selects ONNX Runtime execution providers in GPU-first priority order."""
    preferred = [
        "CUDAExecutionProvider",
        "CoreMLExecutionProvider",
        "CPUExecutionProvider",
    ]
    try:
        import onnxruntime as ort  # type: ignore

        available = set(ort.get_available_providers())
        selected = [p for p in preferred if p in available]
        if selected:
            return selected
    except Exception:
        pass
    return ["CPUExecutionProvider"]


def parse_hex_color(raw: str) -> Tuple[int, int, int]:
    match = HEX_COLOR_RE.match((raw or "").strip())
    if not match:
        raise PipelineError(f"Invalid hex color '{raw}'. Expected '#RRGGBB'.")
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return (
        int(digits[0:2], 16),
        int(digits[2:4], 16),
        int(digits[4:6], 16),
    )


def _has_meaningful_alpha(image: Image.Image) -> bool:
    if image.mode in ("RGBA", "LA"):
        extrema = image.getchannel("A").getextrema()
        return extrema[0] < 255
    if image.mode == "P" and "transparency" in image.info:
        return True
    return False


def _mime_for_extension(ext: str) -> str:
    return FORMAT_MIME_TYPES.get(ext.lower(), "application/octet-stream")


def _pil_save_format(ext: str) -> str:
    lowered = ext.lower().lstrip(".")
    if lowered in ("jpg", "jpeg"):
        return "JPEG"
    if lowered == "png":
        return "PNG"
    if lowered == "webp":
        return "WEBP"
    if lowered == "bmp":
        return "BMP"
    if lowered == "tiff":
        return "TIFF"
    return "PNG"


class StudioPipeline:
    """Manages non-destructive image storage, chaining, AI inference, and ZIP export."""

    def __init__(
        self,
        working_dir: Optional[str | Path] = None,
        model_cache_dir: Optional[str | Path] = None,
        max_cpu_workers: Optional[int] = None,
        spandrel_runner: Optional[Callable[[Image.Image, str, Callable[[str, float], None]], Image.Image]] = None,
        rembg_runner: Optional[Callable[[Image.Image, bool, Callable[[str, float], None]], Image.Image]] = None,
        folder_opener: Optional[Callable[[Path], None]] = None,
    ) -> None:
        self.working_dir = resolve_working_dir(working_dir)
        self.output_dir = self.working_dir / "output"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._prev_temp_env = {
            "TMPDIR": os.environ.get("TMPDIR"),
            "TEMP": os.environ.get("TEMP"),
            "TMP": os.environ.get("TMP"),
        }
        self._prev_tempfile_tempdir = tempfile.tempdir
        self.model_cache_dir = configure_model_cache(self.working_dir, model_cache_dir)

        self._gpu_semaphore = threading.Semaphore(1)
        self._model_lock = threading.Lock()
        self._cpu_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=max_cpu_workers or min(4, os.cpu_count() or 2),
            thread_name_prefix="studio-cpu",
        )
        self._spandrel_models: Dict[str, Any] = {}
        self._rembg_session: Any = None
        self._rembg_providers: List[str] = []
        self._spandrel_runner = spandrel_runner
        self._rembg_runner = rembg_runner
        self._folder_opener = folder_opener

    def close(self) -> None:
        self._cpu_pool.shutdown(wait=False, cancel_futures=False)
        for key, val in self._prev_temp_env.items():
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val
        tempfile.tempdir = self._prev_tempfile_tempdir

    # --- Filename & Path Security ---

    def validate_filename(self, filename: str, *, allow_missing: bool = False) -> Path:
        """Validates a single image filename inside working_dir and blocks traversal."""
        if not isinstance(filename, str):
            raise PipelineError("Filename must be a string.")
        cleaned = filename.strip()
        if not cleaned or "\x00" in cleaned:
            raise PipelineError("Filename must not be empty.")
        if "/" in cleaned or "\\" in cleaned or ".." in cleaned:
            raise PipelineError(f"Invalid filename '{filename}': path separators are forbidden.")
        if cleaned.startswith(".") or cleaned == "output":
            raise PipelineError(f"Invalid filename '{filename}': hidden or reserved name.")

        candidate = self.working_dir / cleaned
        if candidate.name != cleaned:
            raise PipelineError(f"Invalid filename '{filename}'.")
        if candidate.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise PipelineError(
                f"Unsupported image format '{candidate.suffix}'. Allowed: {sorted(SUPPORTED_EXTENSIONS)}"
            )
        if candidate.is_symlink():
            raise PipelineError(f"Symlinks are forbidden: '{cleaned}'.")

        resolved_parent = candidate.parent.resolve()
        if resolved_parent != self.working_dir:
            raise PipelineError(f"Path traversal rejected for '{filename}'.")

        if not allow_missing:
            if not candidate.exists() or not candidate.is_file():
                raise PipelineError(f"Image '{cleaned}' not found in workspace.")
        return candidate

    def _find_output_files_for_stem(self, stem: str) -> List[Path]:
        if not self.output_dir.is_dir():
            return []
        matches: List[Path] = []
        for entry in sorted(self.output_dir.iterdir(), key=lambda p: p.name.lower()):
            if entry.name.startswith(".") or entry.is_symlink() or not entry.is_file():
                continue
            if entry.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            if entry.stem == stem:
                matches.append(entry)
        return matches

    def find_output_file(self, stem: str) -> Optional[Path]:
        matches = self._find_output_files_for_stem(stem)
        return matches[0] if matches else None

    def resolve_active_source(self, filename: str) -> Tuple[Path, Path, bool]:
        """Returns (original_path, active_source_path, is_chained_from_output)."""
        orig_path = self.validate_filename(filename, allow_missing=False)
        existing_output = self.find_output_file(orig_path.stem)
        if existing_output is not None:
            return orig_path, existing_output, True
        return orig_path, orig_path, False

    # --- Workspace Operations ---

    @staticmethod
    def _extract_image_meta(im: Image.Image) -> Tuple[Optional[float], Optional[float], Optional[str]]:
        color_mode = str(im.mode) if getattr(im, "mode", None) else None
        raw_dpi = im.info.get("dpi") if isinstance(getattr(im, "info", None), dict) else None
        dpi_x: Optional[float] = None
        dpi_y: Optional[float] = None
        if isinstance(raw_dpi, (tuple, list)) and len(raw_dpi) >= 2:
            try:
                x_val = float(raw_dpi[0])
                y_val = float(raw_dpi[1])
                if x_val > 0 and y_val > 0:
                    dpi_x = round(x_val, 1)
                    dpi_y = round(y_val, 1)
            except (TypeError, ValueError):
                pass
        elif isinstance(raw_dpi, (int, float)) and float(raw_dpi) > 0:
            dpi_x = round(float(raw_dpi), 1)
            dpi_y = dpi_x
        return dpi_x, dpi_y, color_mode

    def _build_file_record(self, orig_path: Path) -> StudioFileRecord:
        stat = orig_path.stat()
        with Image.open(orig_path) as im:
            orig_w, orig_h = im.size
            orig_dpi_x, orig_dpi_y, orig_color_mode = self._extract_image_meta(im)

        output_path = self.find_output_file(orig_path.stem)
        is_processed = output_path is not None
        out_name: Optional[str] = None
        out_mime: Optional[str] = None
        out_size: Optional[int] = None
        out_w: Optional[int] = None
        out_h: Optional[int] = None
        out_dpi_x: Optional[float] = None
        out_dpi_y: Optional[float] = None
        out_color_mode: Optional[str] = None

        preview_path = orig_path
        if output_path is not None:
            preview_path = output_path
            out_stat = output_path.stat()
            out_name = output_path.name
            out_mime = _mime_for_extension(output_path.suffix)
            out_size = out_stat.st_size
            with Image.open(output_path) as out_im:
                out_w, out_h = out_im.size
                out_dpi_x, out_dpi_y, out_color_mode = self._extract_image_meta(out_im)

        thumb_bytes, thumb_mime = self._create_thumbnail(preview_path)
        return StudioFileRecord(
            filename=orig_path.name,
            stem=orig_path.stem,
            extension=orig_path.suffix.lower().lstrip("."),
            mime_type=_mime_for_extension(orig_path.suffix),
            size_bytes=stat.st_size,
            width=orig_w,
            height=orig_h,
            modified_ms=int(stat.st_mtime * 1000),
            is_processed=is_processed,
            output_filename=out_name,
            output_mime_type=out_mime,
            output_size_bytes=out_size,
            output_width=out_w,
            output_height=out_h,
            thumbnail_bytes=thumb_bytes,
            thumbnail_mime=thumb_mime,
            dpi_x=orig_dpi_x,
            dpi_y=orig_dpi_y,
            color_mode=orig_color_mode,
            source="workspace",
            output_dpi_x=out_dpi_x,
            output_dpi_y=out_dpi_y,
            output_color_mode=out_color_mode,
        )

    def _create_thumbnail(self, image_path: Path) -> Tuple[bytes, str]:
        with Image.open(image_path) as im:
            im = ImageOps.exif_transpose(im)
            if im.mode not in ("RGB", "RGBA"):
                im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
            im.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, format="WEBP", quality=82, method=4)
            return buf.getvalue(), "image/webp"

    def list_files(self) -> List[StudioFileRecord]:
        """Scans working_dir for supported images only, ignoring output/, hidden, and non-image files."""
        candidates: List[Path] = []
        for entry in sorted(self.working_dir.iterdir(), key=lambda p: p.name.lower()):
            if entry.name == "output" or entry.name.startswith("."):
                continue
            if entry.is_symlink() or not entry.is_file():
                continue
            if entry.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            candidates.append(entry)

        if not candidates:
            return []

        futures = [self._cpu_pool.submit(self._build_file_record, p) for p in candidates]
        records: List[StudioFileRecord] = []
        for path, fut in zip(candidates, futures):
            try:
                records.append(fut.result())
            except Exception as exc:
                # Skip corrupt/unreadable image files without failing the entire listing
                print(f"[PhotoStudio] Skipping unreadable image '{path.name}': {exc}", flush=True)
        return records

    def save_uploaded_file(
        self,
        filename: str,
        raw_bytes: bytes | memoryview,
        *,
        overwrite: bool = True,
    ) -> StudioFileRecord:
        """Validates raw image bytes and stores them safely inside working_dir."""
        target = self.validate_filename(filename, allow_missing=True)
        if target.exists() and not overwrite:
            # Disambiguate stem if overwrite is disabled
            counter = 1
            while True:
                candidate = self.validate_filename(
                    f"{target.stem}_{counter}{target.suffix.lower()}",
                    allow_missing=True,
                )
                if not candidate.exists():
                    target = candidate
                    break
                counter += 1

        raw_buf = bytes(raw_bytes)
        if not raw_buf:
            raise PipelineError(f"Uploaded file '{filename}' is empty.")

        # Validate that payload is a decodable image using Pillow before writing
        try:
            with Image.open(io.BytesIO(raw_buf)) as im:
                im.verify()
        except Exception as exc:
            raise PipelineError(f"File '{filename}' is not a valid image: {exc}") from exc

        tmp_path = self.working_dir / f".upload_{uuid.uuid4().hex}{target.suffix.lower()}"
        try:
            tmp_path.write_bytes(raw_buf)
            os.replace(tmp_path, target)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

        return self._build_file_record(target)

    def get_image_bytes(
        self,
        filename: str,
        variant: str = "both",
    ) -> Dict[str, Any]:
        """Reads raw original and/or processed image bytes without modifying files."""
        orig_path = self.validate_filename(filename, allow_missing=False)
        output_path = self.find_output_file(orig_path.stem)

        orig_bytes = b""
        orig_mime = _mime_for_extension(orig_path.suffix)
        out_bytes = b""
        out_mime: Optional[str] = None
        out_name: Optional[str] = None

        if variant in ("original", "both"):
            orig_bytes = orig_path.read_bytes()
        if variant in ("output", "both") and output_path is not None:
            out_bytes = output_path.read_bytes()
            out_mime = _mime_for_extension(output_path.suffix)
            out_name = output_path.name

        return {
            "filename": orig_path.name,
            "is_processed": output_path is not None,
            "original_mime": orig_mime,
            "original_bytes": orig_bytes,
            "output_filename": out_name,
            "output_mime": out_mime,
            "output_bytes": out_bytes,
        }

    def restore_file(self, filename: str) -> bool:
        """Removes processed output file(s) for filename while preserving the original."""
        orig_path = self.validate_filename(filename, allow_missing=False)
        removed = False
        for out_file in self._find_output_files_for_stem(orig_path.stem):
            out_file.unlink(missing_ok=True)
            removed = True
        return removed

    def restore_all(self) -> int:
        """Removes all processed files inside output/ without touching originals."""
        if not self.output_dir.is_dir():
            return 0
        count = 0
        for entry in list(self.output_dir.iterdir()):
            if entry.name.startswith(".") or entry.is_symlink() or not entry.is_file():
                continue
            entry.unlink(missing_ok=True)
            count += 1
        return count

    def create_output_zip(self) -> Tuple[bytes, int]:
        """Packages all processed files in output/ into a single in-memory ZIP archive."""
        if not self.output_dir.is_dir():
            raise PipelineError("No processed files available in output/.")
        files = [
            entry
            for entry in sorted(self.output_dir.iterdir(), key=lambda p: p.name.lower())
            if not entry.name.startswith(".")
            and not entry.is_symlink()
            and entry.is_file()
            and entry.suffix.lower() in SUPPORTED_EXTENSIONS
        ]
        if not files:
            raise PipelineError("No processed files available in output/.")

        def _build_zip() -> bytes:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                for item in files:
                    zf.write(item, arcname=item.name)
            return buf.getvalue()

        zip_bytes = self._cpu_pool.submit(_build_zip).result()
        return zip_bytes, len(files)

    def open_working_dir(self) -> Dict[str, Any]:
        """Opens working_dir in the host operating system file manager."""
        self.working_dir.mkdir(parents=True, exist_ok=True)
        path_str = str(self.working_dir)
        try:
            if self._folder_opener is not None:
                self._folder_opener(self.working_dir)
            elif sys.platform == "darwin":
                subprocess.run(
                    ["/usr/bin/open", path_str],
                    check=True,
                    timeout=5,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
            elif sys.platform == "win32":
                os.startfile(path_str)  # type: ignore[attr-defined]
            else:
                subprocess.Popen(
                    ["xdg-open", path_str],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            return {"opened": True, "path": path_str, "message": None}
        except subprocess.CalledProcessError as exc:
            stderr_msg = ""
            if exc.stderr:
                if isinstance(exc.stderr, (bytes, bytearray)):
                    stderr_msg = exc.stderr.decode("utf-8", errors="replace").strip()
                else:
                    stderr_msg = str(exc.stderr).strip()
            msg = stderr_msg or str(exc)
            return {"opened": False, "path": path_str, "message": msg}
        except Exception as exc:
            return {"opened": False, "path": path_str, "message": str(exc)}

    # --- Output Format Resolution & Atomic Saving ---

    def _resolve_output_extension(
        self,
        orig_path: Path,
        source_path: Path,
        requested_format: str,
        result_image: Image.Image,
        *,
        force_alpha_if_auto: bool = False,
    ) -> str:
        fmt = (requested_format or "auto").strip().lower()
        has_alpha = _has_meaningful_alpha(result_image)

        if fmt in ("", "auto"):
            if force_alpha_if_auto or has_alpha:
                # Preserve webp if already webp, otherwise png for lossless alpha
                src_ext = source_path.suffix.lower().lstrip(".")
                return "webp" if src_ext == "webp" else "png"
            src_ext = source_path.suffix.lower().lstrip(".")
            if src_ext in OUTPUT_FORMAT_EXTENSIONS:
                return OUTPUT_FORMAT_EXTENSIONS[src_ext]
            orig_ext = orig_path.suffix.lower().lstrip(".")
            if orig_ext in OUTPUT_FORMAT_EXTENSIONS:
                return OUTPUT_FORMAT_EXTENSIONS[orig_ext]
            return "png"

        if fmt not in OUTPUT_FORMAT_EXTENSIONS:
            raise PipelineError(
                f"Unsupported output format '{requested_format}'. Allowed: auto, png, jpg, webp."
            )
        ext = OUTPUT_FORMAT_EXTENSIONS[fmt]
        if ext == "jpg" and has_alpha and force_alpha_if_auto:
            return "png"
        return ext

    def _save_output_image(
        self,
        orig_path: Path,
        source_path: Path,
        image: Image.Image,
        output_format: str,
        *,
        force_alpha_if_auto: bool = False,
    ) -> Path:
        ext = self._resolve_output_extension(
            orig_path,
            source_path,
            output_format,
            image,
            force_alpha_if_auto=force_alpha_if_auto,
        )
        target = self.output_dir / f"{orig_path.stem}.{ext}"
        pil_format = _pil_save_format(ext)

        img_to_save = image
        save_kwargs: Dict[str, Any] = {}
        if pil_format == "JPEG":
            if img_to_save.mode in ("RGBA", "LA", "P"):
                rgba = img_to_save.convert("RGBA")
                bg = Image.new("RGB", rgba.size, (255, 255, 255))
                bg.paste(rgba, mask=rgba.getchannel("A"))
                img_to_save = bg
            elif img_to_save.mode != "RGB":
                img_to_save = img_to_save.convert("RGB")
            save_kwargs = {"quality": 94, "optimize": True}
        elif pil_format == "WEBP":
            if img_to_save.mode not in ("RGB", "RGBA"):
                img_to_save = img_to_save.convert("RGBA" if _has_meaningful_alpha(img_to_save) else "RGB")
            save_kwargs = {"quality": 92, "method": 4}
        elif pil_format == "PNG":
            if img_to_save.mode not in ("RGB", "RGBA", "L", "LA"):
                img_to_save = img_to_save.convert("RGBA")
            save_kwargs = {"optimize": True}

        tmp_path = self.output_dir / f".tmp_{uuid.uuid4().hex}.{ext}"
        try:
            img_to_save.save(tmp_path, format=pil_format, **save_kwargs)
            os.replace(tmp_path, target)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

        # Remove stale output files with the same stem but different extension
        for stale in self._find_output_files_for_stem(orig_path.stem):
            if stale != target:
                stale.unlink(missing_ok=True)

        return target

    # --- Model Loading & AI Runners ---

    def _download_model_if_needed(
        self,
        model_key: str,
        emit_progress: Callable[[str, float], None],
    ) -> Path:
        spec = SPANDREL_MODEL_SPECS[model_key]
        spandrel_dir = self.model_cache_dir / "spandrel"
        spandrel_dir.mkdir(parents=True, exist_ok=True)
        dest = spandrel_dir / spec["filename"]
        if dest.is_file() and dest.stat().st_size > 0:
            return dest

        emit_progress("downloading_model", 5.0)
        tmp_dest = spandrel_dir / f".tmp_{uuid.uuid4().hex}_{spec['filename']}"
        req = urllib.request.Request(
            spec["url"],
            headers={"User-Agent": "JetPack-AI-Photo-Studio/0.1.0"},
        )
        try:
            ssl_ctx = _build_ssl_context()
            with urllib.request.urlopen(req, timeout=120, context=ssl_ctx) as resp:
                total = int(resp.headers.get("Content-Length") or 0)
                downloaded = 0
                with open(tmp_dest, "wb") as out_f:
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        out_f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            pct = min(35.0, 5.0 + 30.0 * (downloaded / total))
                            emit_progress("downloading_model", pct)
            os.replace(tmp_dest, dest)
        finally:
            if tmp_dest.exists():
                tmp_dest.unlink(missing_ok=True)
        return dest

    def _get_spandrel_model(
        self,
        model_key: str,
        emit_progress: Callable[[str, float], None],
        *,
        force_cpu: bool = False,
    ) -> Tuple[Any, str]:
        device = "cpu" if force_cpu else get_torch_device()
        cache_key = f"{model_key}:{device}"
        with self._model_lock:
            cached = self._spandrel_models.get(cache_key)
            if cached is not None:
                return cached, device

            model_path = self._download_model_if_needed(model_key, emit_progress)
            emit_progress("loading_model", 40.0)
            import spandrel  # type: ignore

            try:
                model = spandrel.ModelLoader(device=device).load_from_file(str(model_path))
                model.eval()
                self._spandrel_models[cache_key] = model
                return model, device
            except Exception as exc:
                if device != "cpu":
                    print(
                        f"[PhotoStudio] Spandrel load on {device} failed ({exc}); falling back to cpu.",
                        flush=True,
                    )
                    cpu_key = f"{model_key}:cpu"
                    cached_cpu = self._spandrel_models.get(cpu_key)
                    if cached_cpu is None:
                        cached_cpu = spandrel.ModelLoader(device="cpu").load_from_file(str(model_path))
                        cached_cpu.eval()
                        self._spandrel_models[cpu_key] = cached_cpu
                    return cached_cpu, "cpu"
                raise

    def _run_spandrel_tiled(
        self,
        image: Image.Image,
        model_key: str,
        emit_progress: Callable[[str, float], None],
        *,
        force_cpu: bool = False,
    ) -> Image.Image:
        if self._spandrel_runner is not None:
            return self._spandrel_runner(image, model_key, emit_progress)

        import numpy as np  # type: ignore
        import torch  # type: ignore
        import torch.nn.functional as F  # type: ignore

        model, device = self._get_spandrel_model(model_key, emit_progress, force_cpu=force_cpu)
        scale = int(getattr(model, "scale", 1) or 1)

        has_alpha = image.mode in ("RGBA", "LA")
        alpha = image.getchannel("A") if has_alpha else None
        rgb = image.convert("RGB")
        w, h = rgb.size

        np_img = np.asarray(rgb, dtype=np.float32) / 255.0
        # [H, W, C] -> [1, C, H, W]
        tensor_in = torch.from_numpy(np.transpose(np_img, (2, 0, 1))).unsqueeze(0)

        tile_size = 512
        tile_pad = 32
        fixed_dim = tile_size + 2 * tile_pad
        tiles_x = max(1, (w + tile_size - 1) // tile_size)
        tiles_y = max(1, (h + tile_size - 1) // tile_size)
        total_tiles = tiles_x * tiles_y

        out_np = np.zeros((h * scale, w * scale, 3), dtype=np.float32)

        try:
            with torch.inference_mode():
                tile_idx = 0
                for y in range(tiles_y):
                    for x in range(tiles_x):
                        ofs_x = x * tile_size
                        ofs_y = y * tile_size
                        in_start_x = max(ofs_x - tile_pad, 0)
                        in_end_x = min(ofs_x + tile_size + tile_pad, w)
                        in_start_y = max(ofs_y - tile_pad, 0)
                        in_end_y = min(ofs_y + tile_size + tile_pad, h)

                        tile_cpu = tensor_in[:, :, in_start_y:in_end_y, in_start_x:in_end_x]
                        th, tw = tile_cpu.shape[2], tile_cpu.shape[3]
                        if device == "mps" and (th < fixed_dim or tw < fixed_dim):
                            # Uniform MPS tile size prevents MPSGraph recompilation on edge tiles
                            tile_cpu = F.pad(
                                tile_cpu,
                                (0, fixed_dim - tw, 0, fixed_dim - th),
                                mode="replicate",
                            )

                        tile = tile_cpu.to(device)
                        pred_t = model(tile).clamp(0.0, 1.0)
                        if device == "mps" and (th < fixed_dim or tw < fixed_dim):
                            pred_t = pred_t[:, :, : th * scale, : tw * scale]
                        pred = pred_t.squeeze(0).cpu().numpy()
                        pred_hwc = np.transpose(pred, (1, 2, 0))

                        out_start_x = ofs_x * scale
                        out_end_x = min(ofs_x + tile_size, w) * scale
                        out_start_y = ofs_y * scale
                        out_end_y = min(ofs_y + tile_size, h) * scale

                        crop_start_x = (ofs_x - in_start_x) * scale
                        crop_end_x = crop_start_x + (out_end_x - out_start_x)
                        crop_start_y = (ofs_y - in_start_y) * scale
                        crop_end_y = crop_start_y + (out_end_y - out_start_y)

                        out_np[out_start_y:out_end_y, out_start_x:out_end_x, :] = pred_hwc[
                            crop_start_y:crop_end_y, crop_start_x:crop_end_x, :
                        ]

                        tile_idx += 1
                        emit_progress("processing", 45.0 + 45.0 * (tile_idx / total_tiles))
        except Exception as exc:
            if device != "cpu" and not force_cpu:
                print(
                    f"[PhotoStudio] Spandrel inference on {device} failed ({exc}); retrying on cpu.",
                    flush=True,
                )
                return self._run_spandrel_tiled(image, model_key, emit_progress, force_cpu=True)
            raise

        out_u8 = (np.clip(out_np, 0.0, 1.0) * 255.0).round().astype(np.uint8)
        out_rgb = Image.fromarray(out_u8, mode="RGB")

        if alpha is not None:
            resized_alpha = alpha.resize((w * scale, h * scale), Image.Resampling.LANCZOS)
            out_rgba = out_rgb.convert("RGBA")
            out_rgba.putalpha(resized_alpha)
            return out_rgba
        return out_rgb

    def _get_rembg_session(
        self,
        emit_progress: Callable[[str, float], None],
        *,
        force_cpu: bool = False,
    ) -> Any:
        with self._model_lock:
            if self._rembg_session is not None and not force_cpu:
                return self._rembg_session
            if self._rembg_session is not None and force_cpu and self._rembg_providers == ["CPUExecutionProvider"]:
                return self._rembg_session
            emit_progress("downloading_model", 15.0)
            import rembg  # type: ignore

            providers = ["CPUExecutionProvider"] if force_cpu else get_onnx_providers()
            emit_progress("loading_model", 35.0)
            try:
                self._rembg_session = rembg.new_session("isnet-general-use", providers=providers)
                self._rembg_providers = list(providers)
            except Exception as exc:
                if providers != ["CPUExecutionProvider"]:
                    print(
                        f"[PhotoStudio] ONNX providers {providers} failed ({exc}); falling back to CPUExecutionProvider.",
                        flush=True,
                    )
                    self._rembg_session = rembg.new_session(
                        "isnet-general-use", providers=["CPUExecutionProvider"]
                    )
                    self._rembg_providers = ["CPUExecutionProvider"]
                else:
                    raise
            return self._rembg_session

    def _run_rembg(
        self,
        image: Image.Image,
        *,
        only_mask: bool,
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        if self._rembg_runner is not None:
            return self._rembg_runner(image, only_mask, emit_progress)

        import rembg  # type: ignore

        session = self._get_rembg_session(emit_progress)
        emit_progress("processing", 60.0)
        try:
            result = rembg.remove(image, session=session, only_mask=only_mask)
        except Exception as exc:
            if self._rembg_providers != ["CPUExecutionProvider"]:
                print(
                    f"[PhotoStudio] ONNX inference on {self._rembg_providers} failed ({exc}); retrying on CPUExecutionProvider.",
                    flush=True,
                )
                session = self._get_rembg_session(emit_progress, force_cpu=True)
                result = rembg.remove(image, session=session, only_mask=only_mask)
            else:
                raise
        if not isinstance(result, Image.Image):
            result = Image.open(io.BytesIO(result))
        return result

    # --- Tool Implementations ---

    def _tool_upscale(
        self,
        image: Image.Image,
        params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        scale = int(params.get("scale", 2))
        if scale not in (2, 4):
            raise PipelineError(f"Unsupported upscale scale '{scale}'. Expected 2 or 4.")
        model_key = "upscale_x4" if scale == 4 else "upscale_x2"
        with self._gpu_semaphore:
            return self._run_spandrel_tiled(image, model_key, emit_progress)

    def _tool_enhance(
        self,
        image: Image.Image,
        _params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        orig_size = image.size
        with self._gpu_semaphore:
            try:
                enhanced = self._run_spandrel_tiled(image, "enhance_1x", emit_progress)
            except Exception as exc:
                print(
                    f"[PhotoStudio] enhance_1x failed ({exc}); falling back to upscale_x2 + LANCZOS.",
                    flush=True,
                )
                # Fallback to RealESRGAN_x2plus + high-quality LANCZOS downscale back to 1x
                enhanced = self._run_spandrel_tiled(image, "upscale_x2", emit_progress)
            if enhanced.size != orig_size:
                enhanced = enhanced.resize(orig_size, Image.Resampling.LANCZOS)
            return enhanced

    def _tool_remove_bg(
        self,
        image: Image.Image,
        params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Tuple[Image.Image, bool]:
        bg_mode = str(params.get("bg_mode", "transparent")).strip().lower()
        if bg_mode not in ("transparent", "color"):
            raise PipelineError(f"Invalid bg_mode '{bg_mode}'. Expected 'transparent' or 'color'.")

        with self._gpu_semaphore:
            fg_rgba = self._run_rembg(image, only_mask=False, emit_progress=emit_progress)

        if fg_rgba.mode != "RGBA":
            fg_rgba = fg_rgba.convert("RGBA")

        if bg_mode == "transparent":
            return fg_rgba, True

        rgb = parse_hex_color(str(params.get("bg_color", "#0a84ff")))
        backdrop = Image.new("RGBA", fg_rgba.size, (*rgb, 255))
        composited = Image.alpha_composite(backdrop, fg_rgba)
        return composited.convert("RGB"), False

    def _tool_blur_bg(
        self,
        image: Image.Image,
        params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        raw_level = params.get("level", 40)
        try:
            level = int(round(float(raw_level)))
        except (TypeError, ValueError) as exc:
            raise PipelineError(f"Invalid blur level '{raw_level}'.") from exc
        level = max(1, min(100, level))

        with self._gpu_semaphore:
            mask_img = self._run_rembg(image, only_mask=True, emit_progress=emit_progress)

        if mask_img.mode == "RGBA":
            alpha_mask = mask_img.getchannel("A")
        else:
            alpha_mask = mask_img.convert("L")

        if alpha_mask.size != image.size:
            alpha_mask = alpha_mask.resize(image.size, Image.Resampling.LANCZOS)

        # Slightly feather mask edges for smooth portrait-style transition
        alpha_mask = alpha_mask.filter(ImageFilter.GaussianBlur(radius=1.2))
        radius = max(1.0, level * 0.45)

        emit_progress("compositing", 85.0)
        has_alpha = _has_meaningful_alpha(image)
        base_rgb = image.convert("RGB")
        blurred_rgb = base_rgb.filter(ImageFilter.GaussianBlur(radius=radius))
        composited_rgb = Image.composite(base_rgb, blurred_rgb, alpha_mask)

        if has_alpha:
            out_rgba = composited_rgb.convert("RGBA")
            out_rgba.putalpha(image.getchannel("A"))
            return out_rgba
        return composited_rgb

    def _tool_crop(
        self,
        image: Image.Image,
        params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        src_w, src_h = image.size
        crop_vals = (
            params.get("crop_x"),
            params.get("crop_y"),
            params.get("crop_w"),
            params.get("crop_h"),
        )
        if any(v is not None for v in crop_vals):
            if any(v is None for v in crop_vals):
                raise PipelineError("crop_x, crop_y, crop_w, and crop_h must all be provided together.")
            try:
                cx = float(crop_vals[0])
                cy = float(crop_vals[1])
                cw = float(crop_vals[2])
                ch = float(crop_vals[3])
            except (TypeError, ValueError) as exc:
                raise PipelineError("Crop coordinates must be valid numbers.") from exc

            if cx < -1e-6 or cy < -1e-6 or cw <= 0.0 or ch <= 0.0 or cx >= 1.0 or cy >= 1.0:
                raise PipelineError("Crop coordinates must lie inside [0, 1] with positive size.")
            cx = max(0.0, min(1.0, cx))
            cy = max(0.0, min(1.0, cy))
            cw = max(0.0, min(1.0 - cx, cw))
            ch = max(0.0, min(1.0 - cy, ch))
            if cw <= 0.0 or ch <= 0.0:
                raise PipelineError("Crop region must have positive width and height.")

            crop_w_px = max(1, min(src_w, int(round(cw * src_w))))
            crop_h_px = max(1, min(src_h, int(round(ch * src_h))))
            left = max(0, min(src_w - crop_w_px, int(round(cx * src_w))))
            top = max(0, min(src_h - crop_h_px, int(round(cy * src_h))))
            right = left + crop_w_px
            bottom = top + crop_h_px
            emit_progress("cropping", 55.0)
            return image.crop((left, top, right, bottom))

        raw_mode = params.get("crop_mode")
        crop_mode = str(raw_mode).strip().lower() if raw_mode not in (None, "") else ""
        if crop_mode and crop_mode not in ("keep_aspect", "ratio", "custom"):
            raise PipelineError("crop_mode must be 'keep_aspect', 'ratio', or 'custom'.")

        raw_w = params.get("width")
        raw_h = params.get("height")
        target_w = int(raw_w) if raw_w not in (None, "", 0) else None
        target_h = int(raw_h) if raw_h not in (None, "", 0) else None
        if target_w is not None and target_w <= 0:
            raise PipelineError("Width must be a positive integer.")
        if target_h is not None and target_h <= 0:
            raise PipelineError("Height must be a positive integer.")

        if crop_mode == "ratio":
            rw = target_w or src_w
            rh = target_h or src_h
            src_ratio = src_w / src_h
            target_ratio = rw / rh
            if src_ratio > target_ratio:
                crop_h_px = src_h
                crop_w_px = max(1, min(src_w, int(round(src_h * target_ratio))))
            else:
                crop_w_px = src_w
                crop_h_px = max(1, min(src_h, int(round(src_w / target_ratio))))
        elif crop_mode == "custom":
            crop_w_px = min(src_w, target_w) if target_w is not None else src_w
            crop_h_px = min(src_h, target_h) if target_h is not None else src_h
        else:
            crop_w_px = src_w
            crop_h_px = src_h

        left = (src_w - crop_w_px) // 2
        top = (src_h - crop_h_px) // 2
        emit_progress("cropping", 55.0)
        return image.crop((left, top, left + crop_w_px, top + crop_h_px))

    def _tool_resize(
        self,
        image: Image.Image,
        params: Dict[str, Any],
        emit_progress: Callable[[str, float], None],
    ) -> Image.Image:
        src_w, src_h = image.size
        raw_w = params.get("width")
        raw_h = params.get("height")
        keep_aspect = bool(params.get("keep_aspect", True))
        raw_fit_mode = params.get("fit_mode")
        fit_mode = str(raw_fit_mode).strip().lower() if raw_fit_mode not in (None, "") else ""

        if fit_mode and fit_mode not in ("contain", "cover", "stretch"):
            raise PipelineError("fit_mode must be 'contain', 'cover', or 'stretch'.")

        crop_vals = (
            params.get("crop_x"),
            params.get("crop_y"),
            params.get("crop_w"),
            params.get("crop_h"),
        )
        working_image = image
        if any(v is not None for v in crop_vals):
            if any(v is None for v in crop_vals):
                raise PipelineError("crop_x, crop_y, crop_w, and crop_h must all be provided together.")
            try:
                cx = float(crop_vals[0])
                cy = float(crop_vals[1])
                cw = float(crop_vals[2])
                ch = float(crop_vals[3])
            except (TypeError, ValueError) as exc:
                raise PipelineError("Crop coordinates must be valid numbers.") from exc

            if cx < -1e-6 or cy < -1e-6 or cw <= 0.0 or ch <= 0.0 or cx >= 1.0 or cy >= 1.0:
                raise PipelineError("Crop coordinates must lie inside [0, 1] with positive size.")
            cx = max(0.0, min(1.0, cx))
            cy = max(0.0, min(1.0, cy))
            cw = max(0.0, min(1.0 - cx, cw))
            ch = max(0.0, min(1.0 - cy, ch))
            if cw <= 0.0 or ch <= 0.0:
                raise PipelineError("Crop region must have positive width and height.")

            left = max(0, min(src_w - 1, int(round(cx * src_w))))
            top = max(0, min(src_h - 1, int(round(cy * src_h))))
            right = max(left + 1, min(src_w, int(round((cx + cw) * src_w))))
            bottom = max(top + 1, min(src_h, int(round((cy + ch) * src_h))))
            working_image = image.crop((left, top, right, bottom))

        work_w, work_h = working_image.size

        target_w = int(raw_w) if raw_w not in (None, "", 0) else None
        target_h = int(raw_h) if raw_h not in (None, "", 0) else None

        if target_w is not None and target_w <= 0:
            raise PipelineError("Width must be a positive integer.")
        if target_h is not None and target_h <= 0:
            raise PipelineError("Height must be a positive integer.")
        if target_w is None and target_h is None:
            raise PipelineError("Provide at least one positive dimension (width or height) for resize.")

        if fit_mode == "cover":
            if target_w is not None and target_h is not None:
                new_w, new_h = target_w, target_h
            elif target_w is not None:
                new_w = target_w
                new_h = max(1, int(round(work_h * (target_w / work_w))))
            else:
                assert target_h is not None
                new_h = target_h
                new_w = max(1, int(round(work_w * (target_h / work_h))))
            emit_progress("resizing", 55.0)
            return ImageOps.fit(working_image, (new_w, new_h), method=Image.Resampling.LANCZOS)

        effective_keep_aspect = (
            True if fit_mode == "contain" else False if fit_mode == "stretch" else keep_aspect
        )

        if effective_keep_aspect:
            if target_w is not None and target_h is not None:
                ratio = min(target_w / work_w, target_h / work_h)
                new_w = max(1, int(round(work_w * ratio)))
                new_h = max(1, int(round(work_h * ratio)))
            elif target_w is not None:
                new_w = target_w
                new_h = max(1, int(round(work_h * (target_w / work_w))))
            else:
                assert target_h is not None
                new_h = target_h
                new_w = max(1, int(round(work_w * (target_h / work_h))))
        else:
            new_w = target_w if target_w is not None else work_w
            new_h = target_h if target_h is not None else work_h

        emit_progress("resizing", 55.0)
        return working_image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    # --- Public Processing Entrypoint ---

    def process_file(
        self,
        filename: str,
        tool: str,
        params: Optional[Dict[str, Any]] = None,
        output_format: str = "auto",
        on_progress: Optional[Callable[[str, float], None]] = None,
    ) -> StudioFileRecord:
        """Processes a single image non-destructively, chaining from output/ if present."""
        opts = dict(params or {})
        tool_name = (tool or "").strip().lower()
        emit = on_progress or (lambda _stage, _pct: None)

        orig_path, source_path, _is_chained = self.resolve_active_source(filename)
        emit("loading_image", 5.0)

        with Image.open(source_path) as raw_im:
            image = ImageOps.exif_transpose(raw_im)
            image.load()

        force_alpha_if_auto = False
        if tool_name == "upscale":
            result_img = self._tool_upscale(image, opts, emit)
        elif tool_name == "enhance":
            result_img = self._tool_enhance(image, opts, emit)
        elif tool_name == "remove_bg":
            result_img, force_alpha_if_auto = self._tool_remove_bg(image, opts, emit)
        elif tool_name == "blur_bg":
            result_img = self._tool_blur_bg(image, opts, emit)
        elif tool_name == "crop":
            result_img = self._tool_crop(image, opts, emit)
        elif tool_name == "resize":
            result_img = self._tool_resize(image, opts, emit)
        else:
            raise PipelineError(f"Unsupported tool '{tool}'.")

        emit("saving", 95.0)
        self._save_output_image(
            orig_path,
            source_path,
            result_img,
            output_format,
            force_alpha_if_auto=force_alpha_if_auto,
        )
        emit("complete", 100.0)
        return self._build_file_record(orig_path)

    def process_batch(
        self,
        filenames: Iterable[str],
        tool: str,
        params: Optional[Dict[str, Any]] = None,
        output_format: str = "auto",
        on_progress: Optional[Callable[[str, int, int, float, str], None]] = None,
    ) -> List[StudioFileRecord]:
        """Processes one or more files sequentially or concurrently (CPU) with progress."""
        file_list = list(filenames)
        if not file_list:
            raise PipelineError("No files specified for processing.")
        total = len(file_list)
        tool_name = (tool or "").strip().lower()
        results: List[StudioFileRecord] = []

        if tool_name in ("resize", "crop") and total > 1:
            lock = threading.Lock()
            completed = 0
            max_overall = 0.0

            def _worker(idx: int, fname: str) -> StudioFileRecord:
                nonlocal completed, max_overall

                def _item_prog(stage: str, pct: float) -> None:
                    nonlocal max_overall
                    if on_progress is None or stage == "complete":
                        return
                    with lock:
                        raw_overall = ((completed + pct / 100.0) / total) * 100.0
                        max_overall = max(max_overall, min(99.0, raw_overall))
                        display_idx = min(completed, total - 1)
                        on_progress(fname, display_idx, total, max_overall, stage)

                rec = self.process_file(
                    fname,
                    tool_name,
                    params=params,
                    output_format=output_format,
                    on_progress=_item_prog,
                )
                with lock:
                    completed += 1
                    raw_overall = (completed / total) * 100.0
                    max_overall = max(max_overall, min(100.0, raw_overall))
                    display_idx = completed - 1
                    if on_progress is not None:
                        on_progress(fname, display_idx, total, max_overall, "complete")
                return rec

            futures = [self._cpu_pool.submit(_worker, i, f) for i, f in enumerate(file_list)]
            for fut in futures:
                results.append(fut.result())
            return results

        for idx, fname in enumerate(file_list):
            def _item_prog(stage: str, pct: float, _idx: int = idx, _fname: str = fname) -> None:
                if on_progress is not None:
                    overall = ((_idx + pct / 100.0) / total) * 100.0
                    on_progress(_fname, _idx, total, min(100.0, overall), stage)

            rec = self.process_file(
                fname,
                tool_name,
                params=params,
                output_format=output_format,
                on_progress=_item_prog,
            )
            results.append(rec)
        return results
