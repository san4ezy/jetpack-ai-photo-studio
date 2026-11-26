# Tasks

## 1. Worker Metadata & Type Codegen

- [ ] 1.1 Extend `StudioFileRecord` and `_build_file_record` in `pipeline.py` to extract `dpi_x`, `dpi_y`, `color_mode`, `source`, `output_dpi_x`, `output_dpi_y`, and `output_color_mode` via Pillow and verify with `pytest`/`unittest` on `tests/test_pipeline.py`
- [ ] 1.2 Update `StudioFileEntry` in `worker.py` and run `npm run codegen` (`jetpack codegen --worker worker.py --out src/jetpack-env.d.ts`) to verify `src/jetpack-env.d.ts` compiles cleanly with `npm run typecheck`

## 2. Controller State for View Mode, Versions, and Canvas Zoom/Pan

- [ ] 2.1 Add `projectViewMode` (`'list' | 'grid'`), `StudioFileVersion` model + `getFileVersions(file)` / `fetchVersionBlob(filename, variant)` / `takeVersionIntoWork(filename, versionId)` helpers in `src/studio-controller.ts`, and verify with unit tests in `tests/studio.test.mjs`
- [ ] 2.2 Add canvas scaling & zoom helpers (`computeInitialCanvasScale`, `zoomIn`, `zoomOut`, `resetZoom`, zoom bounds `0.1..8.0`) in `src/studio-controller.ts` covering fit-when-larger vs `1:1` when smaller, and verify with unit tests in `tests/studio.test.mjs`

## 3. Global Layout, Control Strip, Tabbed Toolbar, and Button Groups

- [ ] 3.1 Restructure `index.html` and `src/styles.css` so the left 1/3 column contains the thin single-row `.control-strip` (with `Process` and `Process All` icon buttons in a `.btn-group`) above `#left-panel`, and verify desktop 1/3–2/3 grid and responsive layout in browser preview
- [ ] 3.2 Convert `.toolbar` in `index.html`, `src/styles.css`, and `src/main.ts` into a compact vertical layout with a single row of tool tabs (`role="tablist"`) on top, dynamic active-tool options + `File Type` selector underneath, and no excessive `min-height`, verifying height stays compact and never exceeds 200px
- [ ] 3.3 Replace text labels across all action buttons (`Process`, `Process All`, `Import Folder`, `Add Files`, `Select/Select All/Reset`, view switcher, canvas `Download`/`Restore`, `Restore All`, `Download All`, zoom buttons, version popup actions) with SVG icons + `title`/`aria-label` tooltips, group adjacent buttons into `.btn-group` containers, and add global `contextmenu` suppression in `src/main.ts`

## 4. Project Folder Views, Badges, Version Popup, and File Details Popover

- [ ] 4.1 Implement colored file extension badges (`PNG`, `JPG`, `WEBP`, `BMP`, `TIFF`), checkmark-only processed badge (replacing `"Оброблено"` text), and List vs 3-column Tiles (`grid`) view switcher in `src/main.ts` and `src/styles.css`, verifying 3 tiles fit per row with enlarged previews
- [ ] 4.2 Render the version count badge (`1` or `2`) in the bottom-right corner of each thumbnail and implement the floating `#version-popup` anchored over `#left-panel` with enlarged previews and icon buttons for **Delete**, **Download**, and **Take into work**, verifying click-to-open, outside/Escape dismissal, and working actions
- [ ] 4.3 Implement right-click (`contextmenu`) translucent `#file-info-popover` on `.file-item` showing filename, dimensions, file size, extension/MIME, DPI, color mode, source, modified time, and processed status without opening the browser context menu

## 5. Canvas Scaling, Zoom Controls, and Conditional Minimap Navigator

- [ ] 5.1 Update `#preview-stage` rendering in `src/main.ts` and `src/styles.css` to wrap `.single-viewer` and `.compare-box` in a scrollable `.canvas-viewport` sized via `computeInitialCanvasScale`, verifying images smaller than the viewport default to `1:1` and larger images fit available space
- [ ] 5.2 Add the bottom-right zoom `.btn-group` (`Zoom Out`, `Fit / 1:1`, `Zoom In`, live `%` readout) and verify both single viewer and interactive Before/After slider scale smoothly and remain pixel-accurate
- [ ] 5.3 Implement the conditional minimap navigator beside the zoom controls that appears only when the zoomed image exceeds visible canvas bounds, renders the live viewport rectangle, and supports click/drag panning synchronized with `.canvas-viewport` scroll

## 6. Verification & Build

- [ ] 6.1 Update and run `tests/test_pipeline.py` and `npm test` (`tests/studio.test.mjs`), confirming all Python and TypeScript tests pass
- [ ] 6.2 Run `npm run typecheck`, `npm run build`, and `jetpack validate app.toml`, verifying clean TypeScript compilation, Vite `ui/` bundle output, and manifest validity
