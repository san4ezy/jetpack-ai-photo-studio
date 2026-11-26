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
- Reorganize the 1/3 left column into a thin single-row Control Panel (`Process`, `Process All`, future global actions) above the Project Folder panel.
- Redesign the right-column toolbar into compact horizontal tabs (`Upscale`, `Enhance`, `Remove BG`, `Blur BG`, `Resize`) with contextual options and `File Type` directly below, eliminating rigid excess height.
- Enrich Project Folder with colored extension badges, List / 3-column Tiles toggle, checkmark-only processed badge, bottom-right version count badge + floating version popup, and right-click translucent file metadata popover (including worker-extracted DPI and color mode).
- Standardize action buttons as icon buttons with tooltips inside `.btn-group` containers and block native webview context menus globally.
- Implement fit-or-1:1 initial canvas scaling, bottom-right zoom controls, and an interactive viewport minimap navigator when zoomed past canvas bounds.

**Non-Goals:**
- Persisting multiple intermediate processed files on disk or adding new version-storage RPC opcodes (future change).
- Changing AI inference models, processing algorithms, or `app.toml` permissions.

## Decisions

### 1. Left-Column Control Strip + Compact Tabbed Toolbar
- **Choice**: Split the left `1/3` grid track into a vertical flex stack (`.left-column`) containing `.control-strip` (single compact row) above `#left-panel` (`Project Folder`). In the right `2/3` `.right-panel`, change `.toolbar` from a 3-column grid (`min-height: 164px`) to a compact vertical flex block: `.tool-tabs` (`role="tablist"`) on top and `.toolbar-body` (active tool options + `File Type` selector) beneath it, bounded by `max-height: 164px`.
- **Rationale**: Keeps global execution triggers (`Process`, `Process All`) directly above the file list where targets are selected, while freeing vertical canvas height in the right workspace.
- **Alternative considered**: Full-width control bar across both columns. Rejected per user preference to keep the control strip scoped to the left `1/3` column directly above Project Folder.

### 2. Icon-First Buttons, Button Groups, and Native Context Menu Suppression
- **Choice**:
  - Action buttons (`Process`, `Process All`, `Import Folder`, `Add Files`, `View List/Tiles`, `Select/Select All/Reset`, canvas `Download`/`Restore`, `Download All`, `Restore All`, zoom controls, version actions) use inline 16×16/18×18 SVG icons with `title` and `aria-label` attributes (no visible text labels).
  - Tool tabs keep concise labels next to small icons inside `role="tab"` triggers so the 5 AI tools remain self-explanatory as tabs.
  - Adjacent buttons share a `.btn-group` container (`display: inline-flex`) that collapses inner horizontal borders (`margin-left: -1px`), zeroes inner corner radii, and retains outer corner rounding on `:first-child` and `:last-child`.
  - Register a global `document.addEventListener('contextmenu', (e) => e.preventDefault())` handler in `bootstrapStudioApp()`, then attach item-level `contextmenu` handlers on `.file-item` elements to render the translucent file details popover.
- **Rationale**: Consistent, compact visual rhythm matching JetPack Dark Frosted Glass and native desktop photo studio conventions.

### 3. Forward-Compatible Version Model and Popup Over Project Folder
- **Choice**: Define a `StudioFileVersion` interface in `src/studio-controller.ts` (`id`, `variant: 'original' | 'output'`, `label`, `filename`, `width`, `height`, `sizeBytes`, `mimeType`, `dpiX`, `dpiY`, `isActiveWork`). `controller.getFileVersions(file)` synthesizes `[Original]` (1) or `[Original, Processed]` (2) today, and can later consume a `versions[]` array from `StudioFileEntry` without UI refactoring.
- **Behavior of popup actions**:
  - **Popup placement**: Positioned as a frosted-glass overlay anchored over `#left-panel` (`position: absolute; inset: 10px` or top-anchored over the file area) when clicking `.version-count-badge` (`e.stopPropagation()`).
  - **Скачати (Download)**: Fetches `original` or `output` bytes via `studio.get_image` and downloads that variant.
  - **Видалити (Delete)**: For the `output` variant, calls `controller.restoreSingle(file.filename)`. Disabled on the sole `original` variant (with explanatory tooltip) because deleting the workspace original is out of scope for non-destructive storage.
  - **Взяти в роботу (Take into work)**: Sets that version as the active working file (`selectSingleFile` + if choosing `original` while `output/` exists, prompts/runs `restoreSingle` so the original becomes the active base for subsequent processing; if choosing `output`, marks it active and closes the popup).
- **Alternative considered**: Implementing multi-file intermediate disk storage in `pipeline.py` now. Deferred per user decision; current design requires zero breaking backend changes.

### 4. Enriched Pillow Metadata (`pipeline.py` & `worker.py`)
- **Choice**: Extend `StudioFileRecord` (`pipeline.py`) and `StudioFileEntry` (`worker.py`) with optional fields:
  - `dpi_x: Optional[float] = None`, `dpi_y: Optional[float] = None`, `color_mode: Optional[str] = None`, `source: str = "workspace"`
  - `output_dpi_x: Optional[float] = None`, `output_dpi_y: Optional[float] = None`, `output_color_mode: Optional[str] = None`
- **Extraction**: Read `im.info.get("dpi")` (normalizing tuple `(x, y)` to rounded floats when valid positive numbers) and `im.mode` inside `_build_file_record`. Re-run `npm run codegen` to update `src/jetpack-env.d.ts`.
- **Alternative considered**: Parsing EXIF/PNG headers in TypeScript on the frontend. Rejected because Pillow already opens every image in `_build_file_record` and avoids duplicating binary image parsing in JS.

### 5. Canvas Fit-or-1:1 Scaling, Zoom Controls, and Conditional Minimap
- **Choice**:
  - Wrap `#canvas-content` inside a scrollable `.canvas-viewport` inside `#preview-stage`.
  - Compute initial scale when an active image changes or in `'auto'` mode using natural pixel size `(natW, natH)` and available viewport `(availW, availH)`:
    - If `natW <= availW && natH <= availH`, `scale = 1.0` (100% original size).
    - Else, `scale = Math.min(availW / natW, availH / natH)` (fit within available space).
  - Apply explicit pixel width/height (`Math.round(natW * scale)` × `Math.round(natH * scale)`) to `.single-viewer` and `.compare-box` (with `img` set to `width: 100%; height: 100%`) so Before/After divider `clip-path` and pointer coordinates stay aligned at all zoom levels.
  - **Zoom controls**: Floating bottom-right `.btn-group` in `#preview-stage` (`Zoom Out`, `Auto Fit / 1:1` toggle + `%` readout, `Zoom In`), visible whenever a single image (or Before/After comparison) is active.
  - **Minimap navigator**: Rendered immediately to the left of the zoom `.btn-group` only when `renderedW > availW + 1 || renderedH > availH + 1`. Displays a scaled preview image (`max 120×90px`), an overlay viewport box showing `(scrollLeft / renderedW, scrollTop / renderedH, availW / renderedW, availH / renderedH)`, and pointer-drag/click handlers that smoothly update `canvasViewport.scrollLeft` / `scrollTop`.
- **Rationale**: Explicit sized container avoids CSS `transform: scale(...)` layout-box mismatches with scrollbars, Before/After pointer coordinates, and `ResizeObserver` measurements.

## Risks / Trade-offs

- **Before/After slider vs pan drag when zoomed**: Dragging inside `.compare-box` moves the Before/After divider. → **Mitigation**: Panning while zoomed in Before/After mode works via the minimap navigator, scrollbars/trackpad wheel, or holding `Space` / middle-click drag, while `.single-viewer` allows direct drag-to-pan when overflowing.
- **Large high-DPI images scaled in DOM**: Setting explicit CSS width/height on zoomed `<img>` keeps rendering hardware-accelerated, and `zoom` is clamped (e.g., `0.1` to `8.0`) to prevent extreme layout sizes.
- **Test fixtures in `tests/studio.test.mjs`**: Existing mock `makeFileEntry` objects omit the new optional metadata fields. → **Mitigation**: Keep new fields optional (`?: number | null`) in `StudioFileEntry` and update `tests/test_pipeline.py` and `tests/studio.test.mjs` with explicit coverage for DPI/color mode and zoom/view-mode helpers.
