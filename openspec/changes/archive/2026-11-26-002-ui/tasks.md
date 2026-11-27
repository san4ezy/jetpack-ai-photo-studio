# Tasks

## 1. Worker Metadata & Type Codegen

- [x] 1.1 Extend `StudioFileRecord` and `_build_file_record` in `pipeline.py` to extract `dpi_x`, `dpi_y`, `color_mode`, `source`, `output_dpi_x`, `output_dpi_y`, and `output_color_mode` via Pillow and verify with `pytest`/`unittest` on `tests/test_pipeline.py`
- [x] 1.2 Update `StudioFileEntry` in `worker.py` and run `npm run codegen` (`jetpack codegen --worker worker.py --out src/jetpack-env.d.ts`) to verify `src/jetpack-env.d.ts` compiles cleanly with `npm run typecheck`

## 2. Controller State for View Mode, Versions, and Canvas Zoom/Pan

- [x] 2.1 Add `projectViewMode` (`'list' | 'grid'`), `StudioFileVersion` model + `getFileVersions(file)` / `fetchVersionBlob(filename, variant)` / `takeVersionIntoWork(filename, versionId)` helpers in `src/studio-controller.ts`, and verify with unit tests in `tests/studio.test.mjs`
- [x] 2.2 Add canvas scaling & zoom helpers (`computeInitialCanvasScale`, `zoomIn`, `zoomOut`, `resetZoom`, zoom bounds `0.1..8.0`) in `src/studio-controller.ts` covering fit-when-larger vs `1:1` when smaller, and verify with unit tests in `tests/studio.test.mjs`

## 3. Global Layout, Control Strip, Tabbed Toolbar, and Button Groups

- [x] 3.1 Restructure `index.html` and `src/styles.css` so the left 1/3 column contains the thin single-row `.control-strip` (with `Process` and `Process All` icon buttons in a `.btn-group`) above `#left-panel`, and verify desktop 1/3–2/3 grid and responsive layout in browser preview
- [x] 3.2 Convert `.toolbar` in `index.html`, `src/styles.css`, and `src/main.ts` into a compact vertical layout with a single row of tool tabs (`role="tablist"`) on top, dynamic active-tool options + `File Type` selector underneath, and no excessive `min-height`, verifying height stays compact and never exceeds 200px
- [x] 3.3 Replace text labels across all action buttons (`Process`, `Process All`, `Import Folder`, `Add Files`, `Select/Select All/Reset`, view switcher, canvas `Download`/`Restore`, `Restore All`, `Download All`, zoom buttons, version popup actions) with SVG icons + `title`/`aria-label` tooltips, group adjacent buttons into `.btn-group` containers, and add global `contextmenu` suppression in `src/main.ts`

## 4. Project Folder Views, Badges, Version Popup, and File Details Popover

- [x] 4.1 Implement colored file extension badges (`PNG`, `JPG`, `WEBP`, `BMP`, `TIFF`), checkmark-only processed badge (replacing `"Оброблено"` text), and List vs 3-column Tiles (`grid`) view switcher in `src/main.ts` and `src/styles.css`, verifying 3 tiles fit per row with enlarged previews
- [x] 4.2 Render the version count badge (`1` or `2`) in the bottom-right corner of each thumbnail and implement the floating `#version-popup` anchored over `#left-panel` with enlarged previews and icon buttons for **Delete**, **Download**, and **Take into work**, verifying click-to-open, outside/Escape dismissal, and working actions
- [x] 4.3 Implement right-click (`contextmenu`) translucent `#file-info-popover` on `.file-item` showing filename, dimensions, file size, extension/MIME, DPI, color mode, source, modified time, and processed status without opening the browser context menu

## 5. Canvas Scaling, Zoom Controls, and Conditional Minimap Navigator

- [x] 5.1 Update `#preview-stage` rendering in `src/main.ts` and `src/styles.css` to wrap `.single-viewer` and `.compare-box` in a scrollable `.canvas-viewport` sized via `computeInitialCanvasScale`, verifying images smaller than the viewport default to `1:1` and larger images fit available space
- [x] 5.2 Add the bottom-right zoom `.btn-group` (`Zoom Out`, `Fit / 1:1`, `Zoom In`, live `%` readout) and verify both single viewer and interactive Before/After slider scale smoothly and remain pixel-accurate
- [x] 5.3 Implement the conditional minimap navigator beside the zoom controls that appears only when the zoomed image exceeds visible canvas bounds, renders the live viewport rectangle, and supports click/drag panning synchronized with `.canvas-viewport` scroll

## 6. Verification & Build

- [x] 6.1 Update and run `tests/test_pipeline.py` and `npm test` (`tests/studio.test.mjs`), confirming all Python and TypeScript tests pass
- [x] 6.2 Run `npm run typecheck`, `npm run build`, and `jetpack validate app.toml`, verifying clean TypeScript compilation, Vite `ui/` bundle output, and manifest validity

## 7. Control Panel, Connection Banner, Zoom/Minimap, Cascade, and Open Folder Refinements

- [x] 7.1 Implement `StudioPipeline.open_working_dir()` in `pipeline.py` and `studio.open_folder` (`StudioOpenFolderResult`) in `worker.py`, then regenerate `src/jetpack-env.d.ts` via `npm run codegen`
- [x] 7.2 Update `.control-strip` in `index.html`, `src/styles.css`, and `src/main.ts`: remove `"Керування MPS"` label/badge, style `Process`/`Process All` green, move `Restore All`/`Download All` right after them, and add the `Open Folder` icon button
- [x] 7.3 Fix `.connection-banner[hidden]` CSS and remove redundant startup/progress banner display in `src/main.ts` so `JetPackControlBar` remains the sole status bar in normal connected operation
- [x] 7.4 Stack `#canvas-minimap` above `.zoom-bar` in `.canvas-hud`, add the `100%` (`1:1`) zoom button next to `Fit` (`computeFitCanvasScale`), and highlight active zoom state
- [x] 7.5 Update multi-selection Apple Time Machine cascade in `src/main.ts` and `src/studio-controller.ts` to show 5–7 centered cards with larger vertical spacing receding into darkness (`translateZ`, opacity, brightness) using thumbnails for rear cards
- [x] 7.6 Add unit tests for `studio.open_folder`, `computeFitCanvasScale`, `setZoomExact(1)`, and `openProjectFolder`, then re-run Python tests, `npm test`, `npm run typecheck`, `npm run build`, `jetpack validate app.toml`, and `jetpack-daemon --install-local-app .`

## 8. Clipboard Folder-Open Fallback & Resize Aspect-Ratio Presets

- [x] 8.1 Add `fit_mode` (`contain` | `cover` | `stretch`) to `StudioProcessParams` (`worker.py`) and `_tool_resize` (`pipeline.py` using `ImageOps.fit` for `cover`), improve `open_working_dir` stderr capture, and regenerate `src/jetpack-env.d.ts`
- [x] 8.2 Update `StudioController.openProjectFolder()` (`src/studio-controller.ts` + `src/main.ts`) to copy `working_dir` to clipboard when `opened === false` (sandboxed macOS) and show a helpful toast with Finder `Cmd+Shift+G` instructions instead of an error
- [x] 8.3 Add popular aspect-ratio preset buttons (`1:1`, `4:5`, `9:16`, `16:9`, `4:3`, `3:2`) with icons and `Crop` toggle in `Resize` mode (`src/studio-controller.ts`, `src/main.ts`, `src/styles.css`)
- [x] 8.4 Add tests for `fit_mode: "cover"` (`tests/test_pipeline.py`) and Resize presets + clipboard fallback (`tests/studio.test.mjs`), then verify tests, typecheck, build, manifest, and local install

## 9. Non-Distorting Resize Modes, Canvas Crop Frame, & Secondary Control Panel File Type

- [x] 9.1 Add normalized `crop_x`, `crop_y`, `crop_w`, `crop_h` fields to `StudioProcessParams` (`worker.py`) and crop-before-fit support in `_tool_resize` (`pipeline.py`), then regenerate `src/jetpack-env.d.ts`
- [x] 9.2 Refactor `Resize` controller state (`src/studio-controller.ts`) into mutually exclusive modes (`keep_aspect`, presets `1:1`–`3:2`, `custom`) with automatic dimension population, live proportional `Keep aspect` recalculation, non-distorting `cover` export in all crop modes, and normalized crop-frame state (centered default, batch uses centered default)
- [x] 9.3 Render interactive white crop frame with outer semi-transparent white dimming veil over `.viewer-frame` when `tool === 'resize'` (`src/main.ts`, `src/styles.css`), supporting pointer drag inside image bounds preserving target aspect ratio, and show `<input>` fields only for `Keep aspect` and `Custom` (text dimensions for presets)
- [x] 9.4 Add `.secondary-control-strip` matching left `.control-strip` height above `.toolbar` (`index.html`, `src/styles.css`, `src/main.ts`) hosting a label-free `File Type` `.btn-group` (`AUTO`, `.PNG`, `.JPG`, `.WEBP`) colored identically to Project Folder `.ext-badge` labels
- [x] 9.5 Add Python & JS unit tests for explicit `crop_x/y/w/h`, Resize modes, and crop rect clamping/centering, then verify tests, typecheck, build, manifest, local install, and `openspec validate`
