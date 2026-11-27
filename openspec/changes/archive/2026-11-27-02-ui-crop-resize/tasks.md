# Tasks

## 1. Backend Crop & Resize Separation

- [x] 1.1 Додати `"crop"` у `StudioProcessMeta.tool` та `crop_mode` у `StudioProcessParams` в `worker.py`, перегенерувати `src/jetpack-env.d.ts` (`npm run codegen`).
- [x] 1.2 Реалізувати `StudioPipeline._tool_crop` у `pipeline.py` (точне піксельне вирізання без масштабування для одиночних файлів, центроване `ratio`/`custom` кадрування для batch) та підключити `"crop"` у `process_file` і `process_batch`, перевіривши `Resize` (`contain` vs `stretch`).

## 2. Frontend State, Toolbar & Crop Frame

- [x] 2.1 Розділити стан і методи `Crop` (`CropMode`, `computeMaxCropPixelDimensions`, зв'язані `setCropWidthInput`/`setCropHeightInput`, `getEffectiveCropRect`, `setCropPosition`) та `Resize` (`Keep aspect`/`Custom`, `syncTransformDefaultsForActiveFile`) у `src/studio-controller.ts`.
- [x] 2.2 Додати таб `Crop` перед `Resize` в `index.html`, оновити `renderToolOptions()` та `updateResizeCropOverlay()` у `src/main.ts` (завжди редаговані інлайн-поля `W × H` в одному рядку для обох інструментів; біла рамка кадрування видима лише в `Crop`).

## 3. Tests, Validation & Local Install

- [x] 3.1 Додати тести для `crop` і `resize` (`contain`/`stretch`) у `tests/test_pipeline.py` та `tests/studio.test.mjs`, запустити `tests/test_pipeline.py` (17/17 OK) і `npm test` (8/8 pass).
- [x] 3.2 Виконати `npm run typecheck`, `npm run build`, `openspec validate --all --strict`, `jetpack validate app.toml` і `jetpack-daemon --install-local-app .`.
