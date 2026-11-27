# image-pipeline-worker Specification

## Purpose
Визначає бекенд-конвеєр воркера `worker.py` і `pipeline.py`: недеструктивну роботу з файлами в `JETPACK_APP_HOME` та `output/`, ланцюжкову обробку результатів, zero-copy бінарний протокол обміну, конкурентний GPU/CPU-інференс і пакетне завантаження у ZIP.

## Requirements

### Requirement: Non-Destructive File Storage and Processing Chaining
Воркер MUST зберігати оригінальні завантажені зображення незмінними в корені робочої директорії (`JETPACK_APP_HOME`), записувати всі результати виключно у `<working_dir>/output/<stem>.<ext>` і використовувати наявний файл із `output/` як вхідний для подальших послідовних операцій.

#### Scenario: Sequential tool chaining preserves original and updates output
- **WHEN** користувач обробляє файл `portrait.jpg` інструментом `remove_bg`, а потім застосовує `blur_bg` або `resize`
- **THEN** оригінальний `portrait.jpg` у робочій директорії залишається незмінним, перша операція записує `<working_dir>/output/portrait.png`, а друга бере на вхід `<working_dir>/output/portrait.png` і зберігає результат у `output/`

#### Scenario: Switching output format replaces stale output for the same stem
- **WHEN** для `photo.png` існує `<working_dir>/output/photo.png`, а наступна операція записується з `output_format = "webp"`
- **THEN** воркер зберігає `<working_dir>/output/photo.webp` і видаляє застарілий `<working_dir>/output/photo.png`, щоб кожен оригінал мав щонайбільше один активний результат в `output/`

#### Scenario: Restore removes processed files without touching originals
- **WHEN** викликається `studio.restore` для одного файлу або з прапором `restore_all = true`
- **THEN** відповідні файли в `<working_dir>/output/` видаляються, статуси `is_processed` стають `false`, а файли-оригінали залишаються недоторканими

### Requirement: Strict Image Filtering and Path Traversal Protection
Сканер робочої директорії MUST повертати лише підтримувані формати зображень (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`), ігноруючи `output/`, приховані файли та інші типи, а всі файлові операції MUST блокувати вихід за межі `working_dir`.

#### Scenario: Directory scanner ignores output directory, hidden files, and non-images
- **WHEN** у `working_dir` містяться `photo.jpg`, `.DS_Store`, `notes.txt`, `output/photo.png` і підпапка `tmp/`
- **THEN** `studio.list_files` повертає лише запис для `photo.jpg` із `is_processed = true`

#### Scenario: Malicious filenames cannot escape working directory
- **WHEN** запит містить ім'я файлу на кшталт `../../secret.png` або абсолютний шлях
- **THEN** воркер нормалізує/відхиляє шлях і повертає `system.error` без доступу до файлової системи поза `working_dir`

### Requirement: Zero-Copy Binary Opcodes and Streaming Progress
Усі бінарні дані (завантаження файлів через Drag&Drop, отримання оригіналів/результатів для перегляду, прогрес обробки та ZIP-архів) MUST передаватися через `Uint8Array` / `memoryview` без base64 або JSON-серіалізації байтів усередині метаданих.

#### Scenario: Upload and inspect images via MsgPack metadata plus raw bytes
- **WHEN** фронтенд надсилає `studio.upload_files` з MsgPack-метаданими `{ filename, overwrite }` та бінарним payload `Uint8Array`
- **THEN** воркер декодує MsgPack-заголовок, читає сирі байти через `memoryview(frame.payload)[offset:]`, валідує зображення через `Pillow` і зберігає оригінал у `working_dir`

#### Scenario: Processing emits per-item and overall streaming progress
- **WHEN** викликається `studio.process` для одного або кількох файлів
- **THEN** воркер надсилає потокові фрейми `studio.process.progress` (`job_id`, `filename`, `index`, `total`, `percent`, `stage`) та завершальний фрейм відповіді зі списком оновлених статусів файлів

### Requirement: Six Image Processing Tools and Format Control
Пайплайн MUST підтримувати інструменти `upscale` (`scale: 2 | 4`), `enhance`, `remove_bg` (`bg_mode: "transparent" | "color"`, `bg_color`), `blur_bg` (`level: 1..100`), `crop` (`crop_mode: "keep_aspect" | "ratio" | "custom"`, `crop_x`, `crop_y`, `crop_w`, `crop_h`, `width`, `height`) і `resize` (`width`, `height`, `keep_aspect`, `fit_mode`) із вибором вихідного формату `png | jpg | webp`.

#### Scenario: Transparent background forces PNG when source or selection lacks alpha
- **WHEN** виконується `remove_bg` із `bg_mode = "transparent"` без явного формату з підтримкою альфа-каналу (наприклад, оригінал `.jpg`)
- **THEN** результат кодується у `png` зі збереженням прозорості

#### Scenario: GPU inference concurrency is bounded while CPU crop and resize scale
- **WHEN** паралельно надходять задачі обробки або клієнт опитує список файлів під час інференсу
- **THEN** GPU/ONNX-задачі (`upscale`, `enhance`, `remove_bg`, `blur_bg`) обмежуються семафором (`Semaphore(1)`), `crop` і `resize` виконуються в `ThreadPoolExecutor`, а основний IPC-цикл лишається чутливим до `app.ping` та `studio.list_files`

### Requirement: Batch ZIP Export from Output Directory
Опкод `studio.download_zip` MUST архівувати всі оброблені файли з `<working_dir>/output/` у `.zip` і повертати бінарний payload напряму.

#### Scenario: Download ZIP packages all processed images
- **WHEN** в `output/` є один або кілька оброблених файлів і клієнт викликає `studio.download_zip`
- **THEN** воркер формує валідний ZIP-архів із цими файлами та повертає його байти бінарним фреймом

### Requirement: Rich Image Metadata Extraction for File Inspection
Воркер MUST витягувати з файлів зображень у робочій директорії та `output/` додаткові технічні метадані (DPI по осях X/Y, колірний режим зображення та джерело файлу) і повертати їх у структурі `StudioFileEntry` для відображення в інспекторі деталей файлу.

#### Scenario: File listing and processing include DPI, color mode, and source metadata
- **WHEN** клієнт викликає `studio.list_files`, `studio.upload_files` або `studio.process`
- **THEN** кожен `StudioFileEntry` містить `dpi_x`, `dpi_y` (якщо присутні у метаданих зображення), `color_mode`, `source` (`"workspace"` для файлів у корені робочої директорії), а для оброблених файлів також `output_dpi_x`, `output_dpi_y` та `output_color_mode`

### Requirement: Open Workspace Folder in Host File Manager
Воркер MUST надавати опкод `studio.open_folder`, який намагається відкрити робочу директорію файлів проєкту (`working_dir`) у системному файловому менеджері користувача та безпечно повертає `StudioOpenFolderResult` (`opened`, `path`, `message`), дозволяючи клієнту показати або скопіювати шлях у буфер обміну, якщо системний sandbox обмежує прямий запуск.

#### Scenario: Worker opens working directory via OS file manager
- **WHEN** клієнт викликає `studio.open_folder`
- **THEN** воркер запускає системну команду відкриття директорії (`open` на macOS, `os.startfile` на Windows або `xdg-open` на Linux) для `working_dir` або безпечно повертає `opened = false` зі шляхом `working_dir`, якщо запуск заблокований

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
