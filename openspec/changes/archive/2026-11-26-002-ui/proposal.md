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
  - Replace text labels on action buttons across the workspace (`Process`, `Process All`, `Download All`, `Restore All`, `Open Folder`, `Import Folder`, `Add Files`, `Select/Select All/Reset`, canvas `Download`/`Restore`, zoom controls, view toggle, version popup actions) with clear SVG icons and hover tooltips (`title` / `aria-label`).
  - Group adjacent related buttons into unified `.btn-group` containers with connected borders and shared outer radii.
  - Suppress the default browser/webview context menu globally (`contextmenu` prevention) while allowing custom application popovers (such as the file details popup).
  - Keep `#connection-banner` hidden during normal startup and connected states so it does not duplicate the SDK `JetPackControlBar` status, showing it only for interactive pairing authorization or connection errors.
- **Compact Tabbed Toolbar, Left Control Panel & Right Secondary Control Panel**:
  - Convert the 3-column toolbar into a compact vertical stack: a single row of tool tabs (`Upscale`, `Enhance`, `Remove BG`, `Blur BG`, `Resize`) on top, and contextual tool settings directly beneath the tabs.
  - Add a **Secondary Control Panel** (`secondary-control-strip`) directly above the right-column toolbar with the same thin height as the left Control Panel, hosting a label-free global `File Type` button group (`AUTO`, `.PNG`, `.JPG`, `.WEBP`) colored identically to Project Folder extension badges.
  - In `Resize` mode, organize mutually exclusive sizing buttons starting with `Keep aspect`, followed by aspect-ratio presets (`1:1`, `4:5`, `9:16`, `16:9`, `4:3`, `3:2`) with icons, and ending with `Custom`. Show width/height `<input>` fields only in `Keep aspect` and `Custom` (displaying auto-populated text dimensions in preset modes), auto-fill dimensions for every mode, and prevent image distortion across all modes (`Keep aspect` scales proportionally; all other modes crop proportionally without stretching).
  - Remove the rigid `164px–200px` toolbar height constraint so the toolbar fits its tab row and active tool options tightly without exceeding the previous height.
  - Place a thin, single-row **Control Panel** in the left column (`1/3` width) directly above Project Folder without extra `"Керування MPS"` label clutter, containing distinctly green `Process` / `Process All` buttons followed by `Restore All` / `Download All` and an `Open Folder` button that opens the workspace directory or copies its path to clipboard with a Finder `Cmd+Shift+G` hint when blocked by OS sandbox.
- **Workspace Canvas Scaling, Resize Crop Overlay, Zoom Controls, Minimap & Receding Cascade**:
  - Auto-size the active image to occupy maximum available canvas space when larger than the viewport, while defaulting to `1:1` (100% original pixel size) when the image is smaller than the available canvas area.
  - When `Resize` is active, display an interactive white crop frame over the canvas image matching the active mode's aspect ratio, surrounded by a semi-transparent white dimming veil outside the frame so users clearly see what will be cropped; center the frame by default (used for batch processing) and allow dragging it within image bounds while preserving aspect ratio.
  - Add bottom-right zoom controls (`Zoom Out`, `Fit to workspace`, `100% (1:1)`, `Zoom In`, and percentage readout) to scale the displayed image or inspect original pixel size.
  - Display the pan/viewport minimap navigator **above** the zoom controls whenever the zoomed image exceeds the visible canvas bounds, showing the current viewport rectangle and supporting click/drag panning.
  - Render multi-selection Apple Time Machine cascade with 5–7 centered cards, generous vertical spacing, depth recession into darkness (`translateZ`, decreasing opacity and brightness), and lightweight thumbnail previews on rear cards.
- **Extended Worker File Metadata, Explicit Crop Rect, & Workspace Folder Opening**:
  - Enrich `StudioFileEntry` in `pipeline.py` and `worker.py` with image DPI (`dpi_x`, `dpi_y`), color mode (`color_mode`), source location (`source`), and corresponding output metadata fields (`output_dpi_x`, `output_dpi_y`, `output_color_mode`).
  - Add `studio.open_folder` worker opcode (with frontend clipboard + `Cmd+Shift+G` fallback when LaunchServices is restricted by Seatbelt) and `fit_mode` + optional normalized `crop_x`/`crop_y`/`crop_w`/`crop_h` support for `Resize`, and regenerate `src/jetpack-env.d.ts`.

## Capabilities

### New Capabilities
- *(none — all changes extend existing studio UI and worker capabilities)*

### Modified Capabilities
- `studio-web-ui`: Redesigns the workspace layout (left-column control strip with green Process/Process All, Restore All/Download All, Open Folder with clipboard fallback + Project Folder list/tiles view, version popup, file details popover, global context-menu suppression, icon-first button groups, clean SDK-only connection state; right-column Secondary Control Panel with color-matched `.PNG`/`.JPG`/`.WEBP` `File Type` button group; compact tabbed toolbar with `Keep aspect` → presets → `Custom` non-distorting `Resize` modes + interactive white canvas crop overlay; fit-or-1:1 initial scaling, `Fit` + `100%` zoom controls, conditional minimap above zoom controls, and centered receding Time Machine cascade).
- `image-pipeline-worker`: Extends `StudioFileEntry` metadata returned by `studio.list_files`, `studio.upload_files`, and `studio.process` with Pillow-extracted DPI, color mode, and source information, adds `fit_mode` (`contain`/`cover`/`stretch`) and optional normalized crop region (`crop_x`, `crop_y`, `crop_w`, `crop_h`) to `StudioProcessParams` for `resize`, and adds `studio.open_folder` to resolve/open the workspace directory.

## Impact

- **Frontend**: `index.html`, `src/styles.css`, `src/main.ts`, `src/studio-controller.ts`, `src/jetpack-env.d.ts`.
- **Backend**: `pipeline.py` (`StudioFileRecord`, `_build_file_record`, `_tool_resize`, `open_working_dir`), `worker.py` (`StudioFileEntry`, `StudioProcessParams`, `StudioOpenFolderResult`, `studio.open_folder`), regenerated TypeScript definitions via `jetpack codegen`.
- **Tests**: `tests/test_pipeline.py` and `tests/studio.test.mjs` updated to cover enriched metadata, `studio.open_folder`, `fit_mode: "cover"`, explicit `crop_x/y/w/h`, view modes, version state helpers, resize modes/crop frame helpers, and zoom/fit/`100%` logic.
- **Backwards Compatibility**: Existing RPC opcodes (`studio.list_files`, `studio.upload_files`, `studio.get_image`, `studio.process`, `studio.restore`, `studio.download_zip`) remain compatible; only additive optional fields and additive `studio.open_folder` opcode are introduced.
