# Design

## Context

`ai-photo-studio` currently uses a dark frosted-glass layout (`index.html`, `src/styles.css`, `src/main.ts`, `src/studio-controller.ts`) backed by a sandboxed Python worker (`worker.py`, `pipeline.py`) communicating via MsgPack + binary envelopes over `@jetpack/client`.

See [proposal.md](./proposal.md) for motivation and [specs/studio-web-ui/spec.md](./specs/studio-web-ui/spec.md) / [specs/image-pipeline-worker/spec.md](./specs/image-pipeline-worker/spec.md) for behavior contracts.

Key constraints:
- All RPC types must remain synchronized via `jetpack codegen --worker worker.py --out src/jetpack-env.d.ts` and `tsc --noEmit`.
- `StudioPipeline` currently persists originals in `working_dir/<filename>` and at most one active processed output in `working_dir/output/<stem>.<ext>`.
- Multi-version intermediate history storage on disk is deferred to a future change, so version UI must operate cleanly on the existing 1–2 variants (`Original` and `output/`) while keeping its controller model extensible.

## Goals / Non-Goals

**Goals:**
- Reorganize the 1/3 left column into a thin, label-free single-row Control Panel (`Process`, `Process All` in green, followed by `Restore All`, `Download All`, and `Open Folder`) above the Project Folder panel, paired with an identically sized Secondary Control Panel above the right-column toolbar housing a color-coded global `File Type` button group.
- Redesign the right-column toolbar into compact horizontal tabs (`Upscale`, `Enhance`, `Remove BG`, `Blur BG`, `Resize`) with contextual options directly below (and mutually exclusive non-distorting `Keep aspect` → presets → `Custom` modes in `Resize`), eliminating rigid excess height.
- Enrich Project Folder with colored extension badges, List / 3-column Tiles toggle, checkmark-only processed badge, bottom-right version count badge + floating version popup, and right-click translucent file metadata popover (including worker-extracted DPI and color mode).
- Standardize action buttons as icon buttons with tooltips inside `.btn-group` containers, block native webview context menus globally, and eliminate the redundant connection banner when connected via SDK `JetPackControlBar`.
- Implement fit-or-1:1 initial canvas scaling, an interactive white crop frame with semi-transparent white dimming veil in `Resize` mode, bottom-right zoom controls (`Zoom Out`, `Fit`, `100%`, `Zoom In`), an interactive viewport minimap positioned above the zoom controls when zoomed past canvas bounds, and a centered receding Time Machine cascade for multi-selection.

**Non-Goals:**
- Persisting multiple intermediate processed files on disk or adding new version-storage RPC opcodes (future change).
- Changing AI inference models, processing algorithms, or `app.toml` permissions.

## Decisions

### 1. Left-Column Control Strip + Right-Column Secondary Control Strip + Compact Tabbed Toolbar
- **Choice**: Split the left `1/3` grid track into a vertical flex stack (`.left-column`) containing `.control-strip` (single compact row, `min-height: 44px`) above `#left-panel` (`Project Folder`). Remove the `"Керування MPS"` label/badge from `.control-strip` and house:
  - Green processing `.btn-group`: `#btn-process` (`.btn-process-primary`) and `#btn-process-all` (`.btn-process-soft`).
  - Batch result `.btn-group` right after processing: `#btn-restore-all` and `#btn-download-all` (moved out of `.workspace-footer`).
  - Workspace folder action: `#btn-open-folder` (calls `studio.open_folder` to open `working_dir` in the host OS file manager).
  In the right `2/3` `.right-panel`, mirror `.control-strip` with a thin **Secondary Control Panel** (`.secondary-control-strip`, matching `min-height: 44px` and top alignment) above `.toolbar`. House the global, label-free `File Type` `.btn-group` (`AUTO`, `.PNG`, `.JPG`, `.WEBP`) inside `.secondary-control-strip`, styling `.PNG` (blue), `.JPG` (amber), `.WEBP` (green) with the exact colors of Project Folder `.ext-badge` labels. Change `.toolbar` from a 3-column grid (`min-height: 164px`) to a compact vertical flex block: `.tool-tabs` (`role="tablist"`) on top and `.toolbar-body` (`#tool-options`) beneath it, bounded by `max-height: 180px`.
- **Rationale**: Keeps global execution, batch actions, workspace folder access, and global output format together along one clean top strip across both columns, while maximizing vertical canvas height in `.right-panel`.
- **Alternative considered**: Keeping `File Type` as a `<select>` inside `.toolbar`. Rejected per user request so format selection is global, one-click, and visually tied to Project Folder file-type badge colors.

### 2. Icon-First Buttons, Button Groups, Context Menu Suppression & Connection Banner Fix
- **Choice**:
  - Action buttons (`Process`, `Process All`, `Restore All`, `Download All`, `Open Folder`, `Import Folder`, `Add Files`, `Select/Select All/Reset`, canvas `Download`/`Restore`, zoom controls `Zoom Out`/`Fit`/`100%`/`Zoom In`, version actions) use inline SVG icons with `title` and `aria-label` attributes.
  - `Process` and `Process All` use distinct green styling (`.btn-process-primary` and `.btn-process-soft`) to stand out visually as primary execution actions.
  - Adjacent buttons share a `.btn-group` container (`display: inline-flex`) that collapses inner horizontal borders (`margin-left: -1px`), zeroes inner corner radii, and retains outer corner rounding on `:first-child` and `:last-child`.
  - Register a global `document.addEventListener('contextmenu', (e) => e.preventDefault())` handler in `bootstrapStudioApp()`, then attach item-level `contextmenu` handlers on `.file-item` elements to render the translucent file details popover.
  - Add `.connection-banner[hidden] { display: none; }` in `src/styles.css` (preventing `display: flex` from overriding the `[hidden]` attribute) and keep `#connection-banner` hidden during normal startup/progress, showing it only for `onPairingUri` authorization links or fatal connection errors.
- **Rationale**: Fixes the bug where the `"Підключення до JetPack daemon..."` banner remained visible after connection and avoids duplicating status already rendered by `JetPackControlBar`.

### 3. Forward-Compatible Version Model and Popup Over Project Folder
- **Choice**: Define a `StudioFileVersion` interface in `src/studio-controller.ts` (`id`, `variant: 'original' | 'output'`, `label`, `filename`, `width`, `height`, `sizeBytes`, `mimeType`, `dpiX`, `dpiY`, `isActiveWork`). `controller.getFileVersions(file)` synthesizes `[Original]` (1) or `[Original, Processed]` (2) today, and can later consume a `versions[]` array from `StudioFileEntry` without UI refactoring.
- **Behavior of popup actions**:
  - **Popup placement**: Positioned as a frosted-glass overlay anchored over `#left-panel` (`position: absolute; inset: 8px`) when clicking `.version-badge` (`e.stopPropagation()`).
  - **Скачати (Download)**: Fetches `original` or `output` bytes via `studio.get_image` and downloads that variant.
  - **Видалити (Delete)**: For the `output` variant, calls `controller.restoreSingle(file.filename)`. Disabled on the sole `original` variant (with explanatory tooltip) because deleting the workspace original is out of scope for non-destructive storage.
  - **Взяти в роботу (Take into work)**: Sets that version as the active working file (`selectSingleFile` + if choosing `original` while `output/` exists, restores `output/` so the original becomes the active base for subsequent processing; if choosing `output`, marks it active and closes the popup).
- **Alternative considered**: Implementing multi-file intermediate disk storage in `pipeline.py` now. Deferred per user decision; current design requires zero breaking backend changes.

### 4. Enriched Pillow Metadata, Non-Distorting Resize Crop Modes (`fit_mode` + `crop_x/y/w/h`), & Sandboxed Folder Open Fallback
- **Choice**:
  - Extend `StudioFileRecord` (`pipeline.py`) and `StudioFileEntry` (`worker.py`) with optional fields: `dpi_x`, `dpi_y`, `color_mode`, `source`, `output_dpi_x`, `output_dpi_y`, `output_color_mode`.
  - Add optional `fit_mode: Optional[Literal["contain", "cover", "stretch"]] = None` and normalized crop coordinates `crop_x`, `crop_y`, `crop_w`, `crop_h: Optional[float] = None` (`[0..1]`) to `StudioProcessParams` (`worker.py`) and `_tool_resize` (`pipeline.py`). When `crop_x/y/w/h` are provided, `_tool_resize` crops the selected region proportionally first and applies `ImageOps.fit` (`cover`) so output dimensions match without distortion. When omitted (default centered crop and batch `Process All`), `ImageOps.fit` centers automatically at `(0.5, 0.5)`.
  - Add `StudioOpenFolderResult(opened, path, message)` and `@opcode("studio.open_folder", request=None, response=StudioOpenFolderResult, binary=False)` backed by `StudioPipeline.open_working_dir()`. When macOS Seatbelt `(deny default)` blocks `/usr/bin/open` (`_LSOpenURLsWithCompletionHandler` error `-54`), `open_working_dir` returns `{ opened: false, path, message }`, and `StudioController.openProjectFolder()` copies `path` to the system clipboard and displays an informational toast with the `Cmd+Shift+G` Finder shortcut hint rather than failing silently. Re-run `npm run codegen` to update `src/jetpack-env.d.ts`.
- **Rationale**: Respects `jetpack-daemon`'s strict Seatbelt isolation without modifying the daemon binary, guarantees zero aspect-ratio distortion in every Resize mode (presets and Custom crop proportionally instead of stretching), and honors user-adjusted crop framing on single files while keeping batch processing centered by default.

### 5. Resize Crop Overlay, Canvas Fit-or-1:1 Scaling, Zoom Controls, Minimap, and Receding Cascade
- **Choice**:
  - **Resize Modes & Interactive Canvas Crop Frame**: In `Resize` tool options, provide one mutually exclusive `.btn-group`: `Keep aspect` first, presets (`1:1`, `4:5`, `9:16`, `16:9`, `4:3`, `3:2`) next, and `Custom` last. Automatically fill width/height numbers for every mode (computing proportional height/width live in `Keep aspect` as the user types); render `<input>` fields only for `Keep aspect` and `Custom`, and read-only formatted dimensions (`1080 × 1080`) for presets. On the canvas over `.viewer-frame` when `tool === 'resize'`, render a crisp white border crop box (`.resize-crop-box`) surrounded by a semi-transparent white veil (`box-shadow: 0 0 0 9999px rgba(255, 255, 255, 0.42)` inside `overflow: hidden`) matching the selected mode's aspect ratio. Default to centered; allow pointer dragging within `[0, 1]` bounds preserving aspect ratio on single files; reset to centered when switching files/modes and send `crop_x/y/w/h = null` in batch `Process All`.
  - Wrap `#canvas-content` inside a scrollable `.canvas-viewport` inside `#preview-stage`.
  - Compute initial scale in `'auto'` mode using `(natW, natH)` and `(availW, availH)`: `1.0` when `natW <= availW && natH <= availH`, else `Math.min(availW / natW, availH / natH)`.
  - **Zoom controls**: Floating bottom-right `.canvas-hud` uses `flex-direction: column; align-items: flex-end;` so `#canvas-minimap` renders **above** `.zoom-bar`. Inside `.zoom-bar > .btn-group`: `Zoom Out`, `Fit to workspace` (scales image to occupy maximum viewport space even for smaller images), `100% (1:1)` (sets `scale = 1.0` with active highlight), and `Zoom In`, beside the `%` readout.
  - **Minimap navigator**: Rendered above `.zoom-bar` only when `renderedW > availW + 1 || renderedH > availH + 1`. Displays a scaled preview image, an overlay viewport rectangle, and pointer-drag/click handlers that smoothly update `canvasViewport.scrollLeft` / `scrollTop`.
  - **Multi-selection Apple Time Machine cascade**: Render up to 7 cards (`selected.slice(0, 7)`), centered horizontally (`translateX = 0`), with larger upward vertical spacing (`translateY` stepping upward by ~42px per card) and deep Z recession (`translateZ = -idx * 120px`), progressive scale reduction, and darkening (`opacity` + `filter: brightness(...)`) so rear cards fade cleanly into the dark background. Use full-res preview for `idx === 0` and lightweight `file.thumbUrl` for rear cards (`idx >= 1`), limiting preload to the front card.
- **Rationale**: Makes the exact crop zone immediately visible over the image, prevents stretching in `Custom` or social presets, eliminates horizontal clipping in cascade view, and keeps navigation intuitive above the zoom bar.

## Risks / Trade-offs

- **Before/After slider vs crop overlay / pan drag when zoomed**: Dragging inside `.compare-box` moves the Before/After divider. → **Mitigation**: When `tool === 'resize'` and the user drags `.resize-crop-box`, `.compare-box` yields pointer capture to the crop frame; dragging `.compare-divider` or outside the crop box still moves the slider, and panning while zoomed works via the minimap navigator, scrollbars/trackpad wheel, or holding `Alt`/`Shift`/middle-click drag.
- **Sandboxed OS file manager launch**: macOS Seatbelt denies LaunchServices (`error -54`) from sandboxed workers. → **Mitigation**: `StudioController.openProjectFolder()` gracefully copies `path` to clipboard and shows an informational toast with `Cmd+Shift+G` instructions.
- **Test fixtures in `tests/studio.test.mjs`**: Existing mock `makeFileEntry` objects omit optional metadata fields and mock clients need `studio.open_folder`. → **Mitigation**: Keep metadata fields optional in `StudioFileEntry` and add explicit test cases for `studio.open_folder` clipboard fallback, `computeFitCanvasScale`, `100%` zoom, Resize modes (`Keep aspect`, presets, `Custom`), and centered/moved `crop_x/y/w/h` parameters.
