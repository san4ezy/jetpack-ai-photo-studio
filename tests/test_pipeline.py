"""Unit tests for AI Photo Studio non-destructive pipeline and worker opcodes."""

from __future__ import annotations

import hashlib
import io
import json
import os
import struct
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional

from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from pipeline import PipelineError, StudioPipeline  # noqa: E402
from worker import PhotoStudioWorker, decode_request_payload  # noqa: E402
from jetpack_sdk.framing import pack_msgpack  # noqa: E402


def _make_png_bytes(width: int = 32, height: int = 24, color: tuple[int, int, int, int] = (20, 120, 240, 255)) -> bytes:
    im = Image.new("RGBA", (width, height), color)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _make_jpg_bytes(width: int = 40, height: int = 30, color: tuple[int, int, int] = (210, 90, 40)) -> bytes:
    im = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    im.save(buf, format="JPEG")
    return buf.getvalue()


def _decode_envelope(payload: bytes) -> tuple[dict[str, Any], bytes]:
    meta_len = struct.unpack("<I", payload[:4])[0]
    meta = json.loads(payload[4 : 4 + meta_len].decode("utf-8"))
    return meta, payload[4 + meta_len :]


@dataclass
class _FakeFrame:
    opcode: str
    payload: bytes
    channel_id: int = 1
    correlation_id: Optional[int] = 1


class _FakeClient:
    def __init__(self) -> None:
        self.sent: List[_FakeFrame] = []

    def send_frame(
        self,
        opcode: str,
        payload: bytes = b"",
        channel_id: int = 0,
        correlation_id: Optional[int] = None,
    ) -> None:
        self.sent.append(
            _FakeFrame(
                opcode=opcode,
                payload=payload,
                channel_id=channel_id,
                correlation_id=correlation_id,
            )
        )


class TestStudioPipeline(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.work_dir = Path(self.tmp_dir.name) / "workspace"
        self.cache_dir = Path(self.tmp_dir.name) / "model_cache"

        def mock_spandrel(img: Image.Image, model_key: str, emit: Any) -> Image.Image:
            emit("processing", 70.0)
            factor = 4 if model_key == "upscale_x4" else (2 if model_key == "upscale_x2" else 1)
            return img.resize((img.width * factor, img.height * factor), Image.Resampling.NEAREST)

        def mock_rembg(img: Image.Image, only_mask: bool, emit: Any) -> Image.Image:
            emit("processing", 65.0)
            mask = Image.new("L", img.size, 0)
            for y in range(img.height // 4, (3 * img.height) // 4):
                for x in range(img.width // 4, (3 * img.width) // 4):
                    mask.putpixel((x, y), 255)
            if only_mask:
                return mask
            out = img.convert("RGBA")
            out.putalpha(mask)
            return out

        self.pipeline = StudioPipeline(
            working_dir=self.work_dir,
            model_cache_dir=self.cache_dir,
            spandrel_runner=mock_spandrel,
            rembg_runner=mock_rembg,
        )

    def tearDown(self) -> None:
        self.pipeline.close()
        self.tmp_dir.cleanup()

    def test_model_cache_env_configured(self) -> None:
        self.assertEqual(Path(os.environ["JETPACK_MODEL_CACHE_DIR"]), self.cache_dir)
        self.assertEqual(Path(os.environ["U2NET_HOME"]), self.cache_dir / "u2net")
        self.assertEqual(Path(os.environ["NUMBA_CACHE_DIR"]), self.cache_dir / "numba")
        self.assertEqual(Path(os.environ["TMPDIR"]), self.cache_dir / "tmp")
        self.assertTrue((self.cache_dir / "spandrel").is_dir())
        self.assertTrue((self.cache_dir / "numba").is_dir())
        self.assertTrue((self.cache_dir / "tmp").is_dir())

    def test_list_files_filters_non_images_hidden_and_output(self) -> None:
        (self.work_dir / "photo.jpg").write_bytes(_make_jpg_bytes())
        (self.work_dir / "icon.PNG").write_bytes(_make_png_bytes())
        (self.work_dir / ".DS_Store").write_bytes(b"junk")
        (self.work_dir / ".secret.png").write_bytes(_make_png_bytes())
        (self.work_dir / "notes.txt").write_text("hello", encoding="utf-8")
        (self.work_dir / "subdir").mkdir()
        (self.work_dir / "output" / "photo.png").write_bytes(_make_png_bytes())

        records = self.pipeline.list_files()
        names = [r.filename for r in records]
        self.assertEqual(names, ["icon.PNG", "photo.jpg"])

        by_name = {r.filename: r for r in records}
        self.assertFalse(by_name["icon.PNG"].is_processed)
        self.assertTrue(by_name["photo.jpg"].is_processed)
        self.assertEqual(by_name["photo.jpg"].output_filename, "photo.png")

    def test_rich_metadata_dpi_and_color_mode_extracted(self) -> None:
        im = Image.new("RGB", (64, 48), (10, 20, 30))
        buf = io.BytesIO()
        im.save(buf, format="PNG", dpi=(300, 300))
        (self.work_dir / "print_ready.png").write_bytes(buf.getvalue())

        rec = self.pipeline.process_file("print_ready.png", "resize", {"width": 32, "height": 24, "keep_aspect": False})
        self.assertEqual(rec.color_mode, "RGB")
        self.assertEqual(rec.source, "workspace")
        self.assertAlmostEqual(rec.dpi_x or 0, 300.0, places=0)
        self.assertAlmostEqual(rec.dpi_y or 0, 300.0, places=0)
        self.assertEqual(rec.output_color_mode, "RGB")

    def test_non_destructive_chaining_and_format_replacement(self) -> None:
        orig_bytes = _make_jpg_bytes(40, 30)
        orig_path = self.work_dir / "portrait.jpg"
        orig_path.write_bytes(orig_bytes)
        orig_sha = hashlib.sha256(orig_bytes).hexdigest()

        # Step 1: resize to 80x60 -> writes output/portrait.jpg
        rec1 = self.pipeline.process_file("portrait.jpg", "resize", {"width": 80, "height": 60, "keep_aspect": False})
        self.assertTrue(rec1.is_processed)
        self.assertEqual(rec1.output_filename, "portrait.jpg")
        self.assertEqual((rec1.output_width, rec1.output_height), (80, 60))

        # Step 2: upscale 2x chains on output/portrait.jpg (80x60 -> 160x120) and converts to webp
        rec2 = self.pipeline.process_file("portrait.jpg", "upscale", {"scale": 2}, output_format="webp")
        self.assertEqual(rec2.output_filename, "portrait.webp")
        self.assertEqual((rec2.output_width, rec2.output_height), (160, 120))

        # Stale output/portrait.jpg must be replaced by output/portrait.webp
        self.assertFalse((self.work_dir / "output" / "portrait.jpg").exists())
        self.assertTrue((self.work_dir / "output" / "portrait.webp").exists())

        # Original portrait.jpg must remain byte-for-byte unchanged
        self.assertEqual(hashlib.sha256(orig_path.read_bytes()).hexdigest(), orig_sha)

    def test_remove_bg_transparent_forces_png_and_color_fills(self) -> None:
        (self.work_dir / "hero.jpg").write_bytes(_make_jpg_bytes(32, 32))

        rec_t = self.pipeline.process_file("hero.jpg", "remove_bg", {"bg_mode": "transparent"}, output_format="auto")
        self.assertEqual(rec_t.output_filename, "hero.png")
        with Image.open(self.work_dir / "output" / "hero.png") as im:
            self.assertEqual(im.mode, "RGBA")
            self.assertEqual(im.getpixel((0, 0))[3], 0)
            self.assertEqual(im.getpixel((16, 16))[3], 255)

        rec_c = self.pipeline.process_file("hero.jpg", "remove_bg", {"bg_mode": "color", "bg_color": "#ff0000"}, output_format="jpg")
        self.assertEqual(rec_c.output_filename, "hero.jpg")
        with Image.open(self.work_dir / "output" / "hero.jpg") as im:
            self.assertEqual(im.mode, "RGB")
            r, g, b = im.getpixel((1, 1))
            self.assertGreater(r, 240)
            self.assertLess(g, 15)
            self.assertLess(b, 15)

    def test_blur_bg_and_enhance_tools(self) -> None:
        (self.work_dir / "scene.png").write_bytes(_make_png_bytes(48, 48))
        rec_blur = self.pipeline.process_file("scene.png", "blur_bg", {"level": 60})
        self.assertTrue(rec_blur.is_processed)
        rec_enh = self.pipeline.process_file("scene.png", "enhance", {})
        self.assertEqual((rec_enh.output_width, rec_enh.output_height), (48, 48))

    def test_resize_cover_fit_mode_center_crops_proportionally(self) -> None:
        # Image with green center stripe and red side bands: center-crop 40x20 -> 20x40 keeps center green
        im = Image.new("RGB", (40, 20), (220, 20, 20))
        for x in range(15, 25):
            for y in range(20):
                im.putpixel((x, y), (20, 220, 20))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        (self.work_dir / "wide.png").write_bytes(buf.getvalue())

        rec = self.pipeline.process_file(
            "wide.png",
            "resize",
            {"width": 20, "height": 40, "keep_aspect": False, "fit_mode": "cover"},
        )
        self.assertEqual((rec.output_width, rec.output_height), (20, 40))
        with Image.open(self.work_dir / "output" / "wide.png") as out_im:
            r, g, b = out_im.getpixel((10, 20))
            self.assertGreater(g, 180)
            self.assertLess(r, 60)

        # Invalid fit_mode is rejected cleanly
        with self.assertRaises(PipelineError):
            self.pipeline.process_file(
                "wide.png",
                "resize",
                {"width": 20, "height": 20, "fit_mode": "invalid"},
            )

    def test_resize_explicit_normalized_crop_rect_and_validation(self) -> None:
        # Left third (x in 0..20) is blue; right two thirds are red
        im = Image.new("RGB", (60, 20), (220, 40, 20))
        for x in range(20):
            for y in range(20):
                im.putpixel((x, y), (20, 40, 220))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        (self.work_dir / "split.png").write_bytes(buf.getvalue())

        rec = self.pipeline.process_file(
            "split.png",
            "resize",
            {
                "width": 40,
                "height": 40,
                "keep_aspect": False,
                "fit_mode": "cover",
                "crop_x": 0.0,
                "crop_y": 0.0,
                "crop_w": 1.0 / 3.0,
                "crop_h": 1.0,
            },
        )
        self.assertEqual((rec.output_width, rec.output_height), (40, 40))
        with Image.open(self.work_dir / "output" / "split.png") as out_im:
            r, g, b = out_im.getpixel((20, 20))
            self.assertGreater(b, 180)
            self.assertLess(r, 60)

        # Partial or zero-size crop coordinates must fail cleanly
        with self.assertRaises(PipelineError):
            self.pipeline.process_file(
                "split.png",
                "resize",
                {"width": 20, "height": 20, "fit_mode": "cover", "crop_x": 0.1},
            )
        with self.assertRaises(PipelineError):
            self.pipeline.process_file(
                "split.png",
                "resize",
                {
                    "width": 20,
                    "height": 20,
                    "fit_mode": "cover",
                    "crop_x": 0.0,
                    "crop_y": 0.0,
                    "crop_w": 0.0,
                    "crop_h": 1.0,
                },
            )

    def test_crop_cuts_exact_pixels_without_scaling_and_supports_batch_modes(self) -> None:
        # 60x20 image: left third (0..20) blue, center (20..40) green, right (40..60) red
        im = Image.new("RGB", (60, 20), (220, 40, 20))
        for x in range(20):
            for y in range(20):
                im.putpixel((x, y), (20, 40, 220))
        for x in range(20, 40):
            for y in range(20):
                im.putpixel((x, y), (20, 220, 40))
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        (self.work_dir / "tri.png").write_bytes(buf.getvalue())

        # 1. Explicit single-image crop region: output MUST be 20x20 (actual cropped size, NOT resized!)
        rec_exact = self.pipeline.process_file(
            "tri.png",
            "crop",
            {
                "width": 20,
                "height": 20,
                "crop_mode": "ratio",
                "crop_x": 0.0,
                "crop_y": 0.0,
                "crop_w": 1.0 / 3.0,
                "crop_h": 1.0,
            },
        )
        self.assertEqual((rec_exact.output_width, rec_exact.output_height), (20, 20))
        with Image.open(self.work_dir / "output" / "tri.png") as out_im:
            r, g, b = out_im.getpixel((10, 10))
            self.assertGreater(b, 180)
            self.assertLess(g, 60)

        # Reset output and test batch ratio 1:1 (center 20x20 green square without scaling)
        self.pipeline.restore_file("tri.png")
        rec_ratio = self.pipeline.process_file(
            "tri.png",
            "crop",
            {"width": 1080, "height": 1080, "crop_mode": "ratio"},
        )
        self.assertEqual((rec_ratio.output_width, rec_ratio.output_height), (20, 20))
        with Image.open(self.work_dir / "output" / "tri.png") as out_im:
            r, g, b = out_im.getpixel((10, 10))
            self.assertGreater(g, 180)
            self.assertLess(r, 60)

        # Custom batch crop clamps to source bounds without scaling
        self.pipeline.restore_file("tri.png")
        rec_custom = self.pipeline.process_file(
            "tri.png",
            "crop",
            {"width": 14, "height": 100, "crop_mode": "custom"},
        )
        self.assertEqual((rec_custom.output_width, rec_custom.output_height), (14, 20))

    def test_resize_contain_vs_stretch_behavior(self) -> None:
        (self.work_dir / "rect.png").write_bytes(_make_png_bytes(40, 20))

        # Contain preserves aspect ratio inside 20x40 -> 20x10
        rec_contain = self.pipeline.process_file(
            "rect.png",
            "resize",
            {"width": 20, "height": 40, "keep_aspect": True, "fit_mode": "contain"},
        )
        self.assertEqual((rec_contain.output_width, rec_contain.output_height), (20, 10))

        # Stretch forces exact 10x40 (intentional distortion in Resize: Custom)
        self.pipeline.restore_file("rect.png")
        rec_stretch = self.pipeline.process_file(
            "rect.png",
            "resize",
            {"width": 10, "height": 40, "keep_aspect": False, "fit_mode": "stretch"},
        )
        self.assertEqual((rec_stretch.output_width, rec_stretch.output_height), (10, 40))

    def test_restore_and_restore_all_keep_originals(self) -> None:
        (self.work_dir / "a.png").write_bytes(_make_png_bytes())
        (self.work_dir / "b.jpg").write_bytes(_make_jpg_bytes())
        self.pipeline.process_file("a.png", "resize", {"width": 16})
        self.pipeline.process_file("b.jpg", "resize", {"width": 16})

        self.assertTrue(self.pipeline.restore_file("a.png"))
        self.assertFalse((self.work_dir / "output" / "a.png").exists())
        self.assertTrue((self.work_dir / "a.png").is_file())
        self.assertTrue((self.work_dir / "output" / "b.jpg").exists())

        removed = self.pipeline.restore_all()
        self.assertEqual(removed, 1)
        self.assertFalse((self.work_dir / "output" / "b.jpg").exists())
        self.assertTrue((self.work_dir / "b.jpg").is_file())

    def test_path_traversal_rejected(self) -> None:
        for bad in ("../escape.png", "/etc/passwd", "sub/img.png", ".hidden.png", "output", "bad.txt"):
            with self.assertRaises(PipelineError):
                self.pipeline.validate_filename(bad, allow_missing=True)

    def test_create_output_zip(self) -> None:
        with self.assertRaises(PipelineError):
            self.pipeline.create_output_zip()

        (self.work_dir / "one.png").write_bytes(_make_png_bytes())
        (self.work_dir / "two.jpg").write_bytes(_make_jpg_bytes())
        self.pipeline.process_batch(["one.png", "two.jpg"], "resize", {"width": 20})

        zip_bytes, count = self.pipeline.create_output_zip()
        self.assertEqual(count, 2)
        with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
            self.assertEqual(sorted(zf.namelist()), ["one.png", "two.jpg"])

    def test_batch_resize_does_not_deadlock_when_exceeding_pool_workers(self) -> None:
        small_pool_work = Path(self.tmp_dir.name) / "small_pool_ws"
        bounded_pipeline = StudioPipeline(
            working_dir=small_pool_work,
            model_cache_dir=self.cache_dir,
            max_cpu_workers=2,
        )
        try:
            names = [f"img_{i:02d}.jpg" for i in range(8)]
            for name in names:
                (small_pool_work / name).write_bytes(_make_jpg_bytes(64, 48))

            progress_events: List[tuple[str, int, int, float, str]] = []
            errors: List[BaseException] = []
            records_holder: List[Any] = []

            def _run() -> None:
                try:
                    recs = bounded_pipeline.process_batch(
                        names,
                        "resize",
                        {"width": 32, "height": 24, "keep_aspect": True},
                        on_progress=lambda fn, idx, tot, pct, st: progress_events.append(
                            (fn, idx, tot, pct, st)
                        ),
                    )
                    records_holder.extend(recs)
                except BaseException as exc:  # pragma: no cover
                    errors.append(exc)

            t = threading.Thread(target=_run, daemon=True)
            t.start()
            t.join(timeout=5.0)
            self.assertFalse(t.is_alive(), "process_batch deadlocked on CPU pool resize")
            self.assertEqual(errors, [])
            self.assertEqual(len(records_holder), len(names))
            for rec in records_holder:
                self.assertTrue(rec.is_processed)
                self.assertEqual((rec.output_width, rec.output_height), (32, 24))

            percents = [e[3] for e in progress_events]
            self.assertGreater(len(percents), 0)
            self.assertEqual(percents, sorted(percents))
            self.assertEqual(percents[-1], 100.0)
        finally:
            bounded_pipeline.close()


class TestPhotoStudioWorker(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.pipeline = StudioPipeline(
            working_dir=Path(self.tmp_dir.name) / "ws",
            model_cache_dir=Path(self.tmp_dir.name) / "cache",
        )
        self.client = _FakeClient()
        self.worker = PhotoStudioWorker(self.client, pipeline=self.pipeline)

    def tearDown(self) -> None:
        self.pipeline.close()
        self.tmp_dir.cleanup()

    def test_decode_msgpack_plus_binary_memoryview(self) -> None:
        raw_img = _make_png_bytes()
        payload = pack_msgpack({"filename": "drag.png", "overwrite": True}) + raw_img
        meta, binary_mv = decode_request_payload(payload)
        self.assertIsInstance(binary_mv, memoryview)
        self.assertEqual(meta["filename"], "drag.png")
        self.assertEqual(bytes(binary_mv), raw_img)

    def test_worker_upload_process_get_zip_restore_lifecycle(self) -> None:
        # 1. Upload via zero-copy MsgPack + binary frame
        png_bytes = _make_png_bytes(32, 32)
        upload_payload = pack_msgpack({"filename": "sample.png", "overwrite": True}) + png_bytes
        self.worker.dispatch(_FakeFrame("studio.upload_files", upload_payload, correlation_id=10))
        self.assertEqual(self.client.sent[-1].opcode, "studio.upload_files.ok")
        self.assertEqual(self.client.sent[-1].correlation_id, 10)

        # 2. List files
        self.worker.dispatch(_FakeFrame("studio.list_files", b"", correlation_id=11))
        list_meta, list_bin = _decode_envelope(self.client.sent[-1].payload)
        self.assertEqual(len(list_meta["files"]), 1)
        self.assertGreater(len(list_bin), 0)

        # 3. Process synchronously with progress frames having correlation_id=None
        proc_payload = pack_msgpack(
            {
                "filenames": ["sample.png"],
                "tool": "resize",
                "params": {"width": 16, "height": 16, "keep_aspect": False},
                "output_format": "webp",
                "job_id": "j1",
            }
        )
        self.worker.handle_process(1, 12, proc_payload, async_exec=False)
        progress_frames = [f for f in self.client.sent if f.opcode == "studio.process.progress"]
        self.assertGreaterEqual(len(progress_frames), 2)
        for pf in progress_frames:
            self.assertIsNone(pf.correlation_id)

        done_frame = self.client.sent[-1]
        self.assertEqual(done_frame.opcode, "studio.process.ok")
        self.assertEqual(done_frame.correlation_id, 12)

        # 4. Get image (both original and output)
        self.worker.dispatch(
            _FakeFrame("studio.get_image", pack_msgpack({"filename": "sample.png", "variant": "both"}), correlation_id=13)
        )
        img_meta, img_bin = _decode_envelope(self.client.sent[-1].payload)
        self.assertTrue(img_meta["is_processed"])
        self.assertEqual(img_meta["output_filename"], "sample.webp")
        self.assertEqual(img_meta["original_length"] + img_meta["output_length"], len(img_bin))

        # 5. Download ZIP
        self.worker.dispatch(_FakeFrame("studio.download_zip", b"", correlation_id=14))
        zip_meta, zip_bin = _decode_envelope(self.client.sent[-1].payload)
        self.assertEqual(zip_meta["file_count"], 1)
        with zipfile.ZipFile(io.BytesIO(zip_bin), "r") as zf:
            self.assertEqual(zf.namelist(), ["sample.webp"])

        # 6. Restore & Terminate
        self.worker.dispatch(
            _FakeFrame("studio.restore", pack_msgpack({"filename": "sample.png", "restore_all": False}), correlation_id=15)
        )
        restore_meta, _ = _decode_envelope(self.client.sent[-1].payload)
        self.assertEqual(restore_meta["restored_count"], 1)
        self.assertEqual(restore_meta["processed_count"], 0)

        keep_running = self.worker.dispatch(_FakeFrame("app.terminate", b"", correlation_id=16))
        self.assertFalse(keep_running)
        self.assertEqual(self.client.sent[-1].opcode, "app.terminate.ok")

    def test_worker_open_folder_opcode(self) -> None:
        opened_paths: List[Path] = []
        pipeline_ok = StudioPipeline(
            working_dir=Path(self.tmp_dir.name) / "ws_open",
            model_cache_dir=Path(self.tmp_dir.name) / "cache_open",
            folder_opener=lambda p: opened_paths.append(p),
        )
        try:
            client_ok = _FakeClient()
            worker_ok = PhotoStudioWorker(client_ok, pipeline=pipeline_ok)
            worker_ok.dispatch(_FakeFrame("studio.open_folder", b"", correlation_id=21))
            self.assertEqual(client_ok.sent[-1].opcode, "studio.open_folder.ok")
            meta, _ = _decode_envelope(client_ok.sent[-1].payload)
            self.assertTrue(meta["opened"])
            self.assertEqual(Path(meta["path"]), pipeline_ok.working_dir)
            self.assertEqual(opened_paths, [pipeline_ok.working_dir])
        finally:
            pipeline_ok.close()

        def _failing_opener(_p: Path) -> None:
            raise OSError("desktop launcher unavailable")

        pipeline_err = StudioPipeline(
            working_dir=Path(self.tmp_dir.name) / "ws_open_err",
            model_cache_dir=Path(self.tmp_dir.name) / "cache_open_err",
            folder_opener=_failing_opener,
        )
        try:
            res = pipeline_err.open_working_dir()
            self.assertFalse(res["opened"])
            self.assertIn("desktop launcher unavailable", res["message"])
        finally:
            pipeline_err.close()


if __name__ == "__main__":
    unittest.main()
