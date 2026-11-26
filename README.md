# AI Photo Studio (`dev.codingbro.ai-photo-studio`)

Autonomous local AI Photo Studio built for the **JetPack** platform, combining a sandboxed Python AI worker (`spandrel`, `rembg`, `torch`, `onnxruntime`, `Pillow`) with a Dark Frosted Glass TypeScript + Vite web interface (`@jetpack/client`).

## Features

- **Non-Destructive Pipeline (`pipeline.py`)**: Originals in `JETPACK_APP_HOME` are never modified; all processed outputs are written to `output/<stem>.<ext>`, and sequential tools automatically chain on the latest output version.
- **5 Processing Tools**:
  - `upscale` (`2x` / `4x` Real-ESRGAN via `spandrel` with tiled inference)
  - `enhance` (`1x` neural detail/sharpness via `spandrel`)
  - `remove_bg` (transparent PNG alpha or `#RRGGBB` color fill via `rembg` / ONNX Runtime)
  - `blur_bg` (foreground segmentation mask + smooth Gaussian background blur)
  - `resize` (high-quality `Pillow` `LANCZOS` with optional aspect ratio preservation)
- **Zero-Copy Binary IPC (`worker.py` + `src/codec.ts`)**: Transfers raw image bytes, thumbnails, and ZIP archives via `Uint8Array` and `memoryview` without Base64 overhead.
- **Interactive UI (`ui/`)**: Drag&Drop or folder import, 3-state selection toggle (`Select` → `Select All` → `Reset`), Before/After split slider, multi-selection Time Machine cascade, and `Download` / `Restore` / `Download All` (`.zip`) / `Restore All`.

## Development & Verification

1. Generate TypeScript opcode declarations (`JetPackOpcodeMap`):
   ```bash
   npm run codegen
   ```

2. Build the frontend bundle into `ui/` (served by `jetpack-daemon` at `/apps/dev.codingbro.ai-photo-studio/`):
   ```bash
   npm run build
   ```

3. Run Python and frontend unit tests:
   ```bash
   uv run --no-project --python 3.12 --with pillow --with msgpack --with pydantic python3 -m unittest discover -s tests -v
   npm test
   ```

4. Validate manifest & install locally into `jetpack-daemon`:
   ```bash
   jetpack validate app.toml
   jetpack-daemon --install-local-app .
   ```

5. Package into an OCI Image Layout bundle:
   ```bash
   jetpack package --out ./dist/oci-bundle .
   ```
