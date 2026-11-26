# Proposal

## Why

The core AI photo processing pipeline works reliably, but the current web UI wastes vertical and horizontal space in the toolbar, lacks density/metadata affordances in the Project Folder, relies on verbose text buttons instead of compact icon button groups, and forces images into fixed preview bounds without zoom or viewport pan navigation. Redesigning the layout, controls, and canvas navigation will make day-to-day photo editing faster, cleaner, and ready for multi-version history.

## What Changes

- **Project Folder enhancements (`left-panel`)**:
  - Display color-coded file extension badges/icons (`PNG`, `JPG`, `WEBP`, `BMP`, `TIFF`) alongside file entries.
  - Add a view-mode toggle in the panel header switching between **List** view and **Tiles (Grid)** view (3 tiles per row with larger square/rectangular thumbnails).
  - Replace the `"Оброблено"` text badge with a compact checkmark icon badge.
  - Render a version count badge (`1` for original-only, `2` when an `output/` version exists, extensible for future intermediate versions) in the bottom-right corner of each thumbnail; clicking it opens a floating popup positioned over the Project Folder panel showing larger version previews and icon action buttons (**Delete**, **Download**, **Take into work**).
  - Show a translucent glass details popover on right-click (`contextmenu`) over any file item displaying metadata such as dimensions, file size, extension/MIME, DPI, color mode, modified time, and source/output status.
- **Global UI & Button Ergonomics**:
  - Replace text labels on action buttons across the workspace (`Process`, `Process All`, `Download All`, `Restore All`, `Folder`, `Add Files`, `Select/Select All/Reset`, canvas `Download`/`Restore`, zoom controls, view toggle, version popup actions) with clear SVG icons and hover tooltips (`title` / `aria-label`).
  - Group adjacent related buttons into unified `.btn-group` containers with connected borders and shared outer radii.
  - Suppress the default browser/webview context menu globally (`contextmenu` prevention) while allowing custom application popovers (such as the file details popup).
- **Compact Tabbed Toolbar & Thin Left Control Bar**:
  - Convert the 3-column toolbar into a compact vertical stack: a single row of tool tabs (`Upscale`, `Enhance`, `Remove BG`, `Blur BG`, `Resize`) on top, and contextual tool settings + `File Type` selector directly beneath the tabs.
  - Remove the rigid `164px–200px` toolbar height constraint so the toolbar fits its tab row and active tool options tightly without exceeding the previous height.
  - Move `Process` and `Process All` out of the toolbar into a new thin, single-row **Control Panel** placed in the left column (`1/3` width) directly above the Project Folder panel.
- **Workspace Canvas Scaling, Zoom Controls & Minimap Navigator**:
  - Auto-size the active image to occupy maximum available canvas space when larger than the viewport, while defaulting to `1:1` (100% original pixel size) when the image is smaller than the available canvas area.
  - Add bottom-right zoom controls (zoom out, reset/fit toggle, zoom in, percentage readout) to scale the displayed image (and Before/After comparison box) inside the workspace.
  - Display a pan/viewport minimap navigator next to the zoom controls whenever the zoomed image exceeds the visible canvas bounds, showing the current viewport rectangle and supporting click/drag panning.
- **Extended Worker File Metadata**:
  - Enrich `StudioFileEntry` in `pipeline.py` and `worker.py` with image DPI (`dpi_x`, `dpi_y`), color mode (`color_mode`), source location (`source`), and corresponding output metadata fields (`output_dpi_x`, `output_dpi_y`, `output_color_mode`), and regenerate `src/jetpack-env.d.ts`.

## Capabilities

### New Capabilities
- *(none — all changes extend existing studio UI and worker capabilities)*

### Modified Capabilities
- `studio-web-ui`: Redesigns the workspace layout (left-column control strip + Project Folder list/tiles view, version popup, file details popover, global context-menu suppression, icon-first button groups), converts the toolbar into compact tabs + options, and adds fit-or-1:1 initial scaling, zoom controls, and a conditional minimap navigator to the canvas.
- `image-pipeline-worker`: Extends `StudioFileEntry` metadata returned by `studio.list_files`, `studio.upload_files`, and `studio.process` with Pillow-extracted DPI, color mode, and source information for the file-details popover.

## Impact

- **Frontend**: `index.html`, `src/styles.css`, `src/main.ts`, `src/studio-controller.ts`, `src/jetpack-env.d.ts`.
- **Backend**: `pipeline.py` (`StudioFileRecord`, `_build_file_record`), `worker.py` (`StudioFileEntry`), regenerated TypeScript definitions via `jetpack codegen`.
- **Tests**: `tests/test_pipeline.py` and `tests/studio.test.mjs` updated to cover enriched metadata, view modes, version state helpers, and zoom/fit logic.
- **Backwards Compatibility**: Existing RPC opcodes (`studio.list_files`, `studio.upload_files`, `studio.get_image`, `studio.process`, `studio.restore`, `studio.download_zip`) remain compatible; only additive optional metadata fields are added to `StudioFileEntry`.
