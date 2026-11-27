# Proposal

## Why

У попередній реалізації обрізання та зміна розміру були змішані в одному інструменті `Resize`: вибір області рамкою (`Crop`) підганяв початкове зображення під цільові розміри замість того, щоб буквально вирізати пікселі всередині рамки. Крім того, редаговані поля вводу ширини/висоти були доступні лише для `Keep aspect` та `Custom`, тоді як у режимах співвідношень сторін користувач не міг вказати одну зі сторін рамки, а `Resize: Custom` не дозволяв незалежно змінювати обидві сторони.

## What Changes

- Розділено обрізання та зміну розміру на два окремі інструменти панелі: **`Crop`** і **`Resize`**.
- У бекенд додано інструмент `crop` (`StudioPipeline._tool_crop`) та параметр `crop_mode` (`"keep_aspect" | "ratio" | "custom"`):
  - для одиночного зображення `crop` буквально вирізає область рамки (`image.crop`) без будь-якого масштабування чи викривлення;
  - для пакетної обробки `crop` центровано обрізає кожен файл за пропорцією (`ratio`) або обмеженням (`custom`) без масштабування;
  - `resize` (`StudioPipeline._tool_resize`) розділено на `Keep aspect` (`fit_mode="contain"`, пропорційне масштабування) і `Custom` (`fit_mode="stretch"`, незалежна зміна обох сторін із дозволеним розтягуванням).
- У фронтенді (`StudioController` і `main.ts`):
  - у `Crop` відображаються кнопки `Keep aspect`, `1:1`, `4:5`, `9:16`, `16:9`, `4:3`, `3:2`, `Custom` та завжди активні інлайн-поля `Width × Height` в одному рядку (з взаємним перерахунком в межах оригіналу для всіх режимів співвідношень і незалежним введенням для `Custom`);
  - біла інтерактивна рамка з напівпрозорим білим затіненням зовні показується на полотні лише при активному `Crop`;
  - у `Resize` відображаються кнопки `Keep aspect` і `Custom` з інлайн-полями `Width × Height`;
  - додано синхронізацію розмірів за замовчуванням після кожного послідовного кроку (`Crop` → `Resize` → `Upscale`).

## Capabilities

### New Capabilities
<!-- Немає нових capability; зміна уточнює та розділяє існуючі можливості пайплайна й UI -->

### Modified Capabilities
- `image-pipeline-worker`: Додано інструмент `crop` із точним піксельним вирізанням без масштабування (`_tool_crop`) та чітке розмежування `contain` (`Keep aspect`) і `stretch` (`Custom`) в інструменті `resize`.
- `studio-web-ui`: Додано окремий таб `Crop` перед `Resize`, завжди редаговані інлайн-поля `Width × Height` у `Crop` (пов'язані за співвідношенням у всіх ratio-режимах) і `Resize` (`Keep aspect` / `Custom`), а також прив'язку білої рамки кадрування виключно до інструменту `Crop`.

## Impact

- Worker / Backend: `worker.py`, `pipeline.py`, `src/jetpack-env.d.ts` (перегенеровано через `jetpack codegen`).
- Frontend UI & State: `index.html`, `src/studio-controller.ts`, `src/main.ts`.
- Tests & Specs: `tests/test_pipeline.py`, `tests/studio.test.mjs`, `openspec/specs/image-pipeline-worker/spec.md`, `openspec/specs/studio-web-ui/spec.md`.
