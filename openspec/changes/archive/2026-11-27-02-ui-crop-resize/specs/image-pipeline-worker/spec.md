# Spec Delta

## MODIFIED Requirements

### Requirement: Six Image Processing Tools and Format Control
Пайплайн MUST підтримувати інструменти `upscale` (`scale: 2 | 4`), `enhance`, `remove_bg` (`bg_mode: "transparent" | "color"`, `bg_color`), `blur_bg` (`level: 1..100`), `crop` (`crop_mode: "keep_aspect" | "ratio" | "custom"`, `crop_x`, `crop_y`, `crop_w`, `crop_h`, `width`, `height`) і `resize` (`width`, `height`, `keep_aspect`, `fit_mode`) із вибором вихідного формату `png | jpg | webp`.

#### Scenario: Transparent background forces PNG when source or selection lacks alpha
- **WHEN** виконується `remove_bg` із `bg_mode = "transparent"` без явного формату з підтримкою альфа-каналу (наприклад, оригінал `.jpg`)
- **THEN** результат кодується у `png` зі збереженням прозорості

#### Scenario: GPU inference concurrency is bounded while CPU crop and resize scale
- **WHEN** паралельно надходять задачі обробки або клієнт опитує список файлів під час інференсу
- **THEN** GPU/ONNX-задачі (`upscale`, `enhance`, `remove_bg`, `blur_bg`) обмежуються семафором (`Semaphore(1)`), `crop` і `resize` виконуються в `ThreadPoolExecutor`, а основний IPC-цикл лишається чутливим до `app.ping` та `studio.list_files`

### Requirement: Dedicated Pixel Crop Tool and Stretch/Proportional Resize Tool
Інструмент `crop` MUST вирізати пікселі в межах вказаної прямокутної області (`crop_x`, `crop_y`, `crop_w`, `crop_h` у діапазоні `[0..1]`) або пакетно центрованого кадрування (`crop_mode: "keep_aspect" | "ratio" | "custom"`) без будь-якого масштабування чи спотворення, повертаючи фактичний розмір вирізаної області; тоді як інструмент `resize` MUST підтримувати пропорційну зміну розміру (`keep_aspect = true`, `fit_mode = "contain"`) та незалежну довільну зміну обох сторін (`keep_aspect = false`, `fit_mode = "stretch"`).

#### Scenario: Crop tool cuts exact region without scaling or distortion
- **WHEN** клієнт викликає `studio.process` із `tool = "crop"` та `crop_x`, `crop_y`, `crop_w`, `crop_h` (наприклад, квадрат `540×540` на зображенні `1080×540`)
- **THEN** воркер вирізає лише пікселі всередині рамки (`image.crop`) без масштабування і зберігає результат фактичного розміру (`540×540`)

#### Scenario: Batch crop applies ratio or custom bounds per image without scaling
- **WHEN** клієнт викликає `studio.process` із `tool = "crop"` без `crop_x`/`crop_y`/`crop_w`/`crop_h` для пакетної обробки
- **THEN** у режимі `crop_mode = "ratio"` воркер центровано обрізає кожне зображення під максимальний розмір заданого співвідношення сторін (`width / height`), а у `crop_mode = "custom"` — центровано обрізає в межах `min(src_w, width) × min(src_h, height)` без масштабування

#### Scenario: Resize tool distinguishes Keep aspect (contain) from Custom (stretch)
- **WHEN** клієнт викликає `studio.process` із `tool = "resize"`
- **THEN** при `keep_aspect = true` (`fit_mode = "contain"`) зображення масштабується пропорційно без спотворення, а при `keep_aspect = false` (`fit_mode = "stretch"`) зображення точно масштабується до `width × height` (включно з навмисним розтягуванням/стисненням)
