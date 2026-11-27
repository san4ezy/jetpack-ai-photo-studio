# AI Photo Studio (`dev.codingbro.ai-photo-studio`)

Autonomous local AI Photo Studio built for the **JetPack** platform, combining a sandboxed Python AI worker (`jetpack-sdk`, `spandrel`, `rembg`, `torch`, `onnxruntime`, `Pillow`) with a Dark Frosted Glass TypeScript + Vite web interface (`@jetpack-desktop/client` with bundled WASM).

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

## Updating Dependencies, Rebuilding & Local Verification

1. Update Python and npm SDK packages (`jetpack-sdk` from PyPI, `@jetpack-desktop/client` from npm):
   ```bash
   uv sync --upgrade-package jetpack-sdk
   npm install @jetpack-desktop/client@latest
   ```

2. Regenerate TypeScript opcode declarations (`JetPackOpcodeMap`):
   ```bash
   npm run codegen
   ```

3. Build the frontend bundle into `ui/` (served by `jetpack-daemon` at `/apps/dev.codingbro.ai-photo-studio/`):
   ```bash
   npm run build
   ```

4. Run Python and frontend unit tests:
   ```bash
   uv run python -m unittest discover -s tests -v
   npm test
   ```

5. Validate manifest & install/refresh locally into a running `jetpack-daemon`:
   ```bash
   jetpack validate app.toml
   # Stop the active worker first via JetPack Control Bar or Control Center if running, then:
   jetpack-daemon --install-local-app .
   ```
   If `jetpack-sdk` version changed in `app.toml` for an already-installed `0.1.0` app, clear only the cached app `.venv` before relaunching so `jetpack-daemon` provisions the updated wheel cleanly (model caches stay intact):
   ```bash
   rm -rf ~/Library/Application\ Support/JetPack/apps/dev.codingbro.ai-photo-studio/0.1.0/.venv
   ```
   Then launch/open `http://127.0.0.1:9470/apps/dev.codingbro.ai-photo-studio/` with a hard reload (`Cmd+Shift+R`).

6. Package into an OCI Image Layout bundle:
   ```bash
   jetpack package --out ./dist/oci-bundle .
   ```
