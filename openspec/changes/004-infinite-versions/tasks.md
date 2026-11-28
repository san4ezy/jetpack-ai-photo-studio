# Tasks

## 1. Backend Versioned Storage & Pipeline (`pipeline.py`)

- [ ] 1.1 Implement per-file output subdirectories `output/<stem>/<stem>-v<NNN>.<ext>`, regex-based version discovery sorted by version number, and `.studio_meta.json` persistence for `active_version_id` (falling back to latest version or `"original"`, and cleaning up empty `output/<stem>/` folders). Verify via unit tests in `tests/test_pipeline.py` that sequential processing creates `v001`, `v002`, … without overwriting earlier versions.
- [ ] 1.2 Extend `StudioVersionRecord` and `StudioFileRecord` (`versions`, `active_version_id`, `version_count`, `has_outputs`, plus active version DPI/color/size fields) and update `resolve_active_source()` and `_save_output_image()` so processing from `original` or any intermediate `vNNN` appends monotonic `v(max+1)` and activates it without deleting sibling versions. Verify via unit test covering branching from `v001` and `original`.
- [ ] 1.3 Implement `select_version(filename, version_id)`, `delete_version(filename, version_id)` (rejecting `"original"`, shifting active fallback safely, removing empty folder), `get_version_thumbnails(filename)` (WebP thumbnails), and update `get_image_bytes(filename, variant, version_id=None)` and `restore_file` / `restore_all` to remove whole `output/<stem>/` folders. Verify via unit tests in `tests/test_pipeline.py`.
- [ ] 1.4 Implement thread-safe multi-step `_undo_stack` across `process_file` and `process_batch`, `undo_last_action()` (physically deleting created file(s), restoring previous `active_version_id`, cleaning empty folders), and pruning on `delete_version` / `restore`. Verify via unit tests covering single-file undo, batch `Process All` undo, and multi-step undo.
- [ ] 1.5 Update `create_output_zip()` to recursively archive all version files in `output/<stem>/<stem>-v<NNN>.<ext>` preserving `<stem>/<filename>` paths inside the `.zip`. Verify via `zipfile.ZipFile.namelist()` assertions in `tests/test_pipeline.py`.

## 2. Worker RPC Opcodes & TypeScript Codegen (`worker.py`, `src/jetpack-env.d.ts`)

- [ ] 2.1 Add Pydantic request/response models (`StudioVersionEntry`, `StudioGetVersionThumbnailsMeta/Result`, `StudioSelectVersionMeta/Result`, `StudioDeleteVersionMeta/Result`, `StudioUndoResult`, `StudioUndoRemovedItem`) and update `StudioFileEntry`, `StudioListFilesResult`, `StudioGetImageMeta/Result`, `StudioProcessResult`, `StudioRestoreResult` with `can_undo`, `total_output_versions`, and `version_id` fields. Verify `worker.py` syntax and opcode dispatch in `tests/test_pipeline.py`.
- [ ] 2.2 Implement and register `@opcode` handlers (`studio.get_version_thumbnails`, `studio.select_version`, `studio.delete_version`, `studio.undo`) and update `studio.list_files`, `studio.get_image`, `studio.process`, `studio.restore` in `PhotoStudioWorker`. Verify full worker opcode lifecycle in `tests/test_pipeline.py`.
- [ ] 2.3 Run `npm run codegen` (`jetpack codegen --worker worker.py --out src/jetpack-env.d.ts`) and verify `src/jetpack-env.d.ts` exposes all new opcodes and updated types cleanly.

## 3. Frontend Controller & State Management (`src/studio-controller.ts`)

- [ ] 3.1 Update `StudioController` state (`canUndo`, `totalOutputVersions`, `versionThumbCache`) and getters (`canDownloadAll`, `canRestoreAll`, `canUndoAction`, `processedCount`, `getActiveSourceDimensions`, `getFileVersions`, `getVersionCount`) to support unlimited versions from `file.versions` and `active_version_id`. Verify with `npm test`.
- [ ] 3.2 Update `takeVersionIntoWork(filename, versionId)` to call `studio.select_version` (switching to `original` or any `vNNN` without deleting history), `deleteVersion(filename, versionId)` to call `studio.delete_version`, `fetchVersionBlob(filename, variant, versionId)` to pass `version_id` to `studio.get_image`, and add `loadVersionThumbnails(filename)` and `undoLastAction()` (`studio.undo`) with proper `previewCache` and `versionThumbCache` invalidation/cleanup. Verify with unit tests in `tests/studio.test.mjs`.

## 4. UI Markup, Styling & Canvas Integration (`index.html`, `src/styles.css`, `src/main.ts`)

- [ ] 4.1 Add the icon-only `#btn-undo` button (without text, curved-left undo SVG icon, tooltip, disabled binding) to `.control-strip-left` beside `#btn-process` and `#btn-process-all` in `index.html`, and wire its click handler to `controller.undoLastAction()` in `src/main.ts`. Verify layout and disabled/enabled states in rendered DOM/build.
- [ ] 4.2 Update `#version-popup` rendering in `src/main.ts` and `.version-popup` styles in `src/styles.css` to lazily load and display individual thumbnails for `Оригінал` and all intermediate `vNNN` versions, highlight the active `"В роботі"` card, and wire `"Взяти в роботу"`, `"Скачати"`, and `"Видалити"` for each version. Verify popup rendering and actions with multi-version files.
- [ ] 4.3 Update Project Folder status checkmark (`file.has_outputs` / `version_count > 1`), active extension badge, `lastCanvasRenderKey` (tracking `active_version_id`), Before/After vs single-Original canvas view, and status footer readout in `src/main.ts` so switching versions or undoing immediately updates the canvas, minimap, and Crop/Resize bounds. Verify `npm run build` (`tsc --noEmit && vite build`) succeeds cleanly.

## 5. Verification & Packaging Checks

- [ ] 5.1 Run Python test suite (`python3 -m unittest discover -s tests` / `.venv/bin/python -m unittest discover -s tests`) and verify all pipeline and worker tests pass.
- [ ] 5.2 Expand and run frontend unit tests (`npm test`) covering infinite version listing, non-destructive switching to `original` and `v001`, deleting arbitrary intermediate versions, multi-step `Undo`, and `resolveViewfinderImageState`.
- [ ] 5.3 Run `npm run build` (`tsc --noEmit && vite build`), `jetpack validate app.toml`, and `git status` / symlink check to confirm clean production assets in `ui/` and adherence to JetPack invariants.
