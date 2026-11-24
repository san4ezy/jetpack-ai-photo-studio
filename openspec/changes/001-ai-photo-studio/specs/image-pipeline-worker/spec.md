# Spec Delta: Image Pipeline Worker

## Purpose
Визначає бекенд-конвеєр воркера `worker.py` і `pipeline.py`: недеструктивну роботу з файлами в `JETPACK_APP_HOME` та `output/`, ланцюжкову обробку результатів, zero-copy бінарний протокол обміну, конкурентний GPU/CPU-інференс і пакетне завантаження у ZIP.

## ADDED Requirements

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

### Requirement: Five Image Processing Tools and Format Control
Пайплайн MUST підтримувати інструменти `upscale` (`scale: 2 | 4`), `enhance`, `remove_bg` (`bg_mode: "transparent" | "color"`, `bg_color`), `blur_bg` (`level: 1..100`) і `resize` (`width`, `height`, `keep_aspect`) із вибором вихідного формату `png | jpg | webp`.

#### Scenario: Transparent background forces PNG when source or selection lacks alpha
- **WHEN** виконується `remove_bg` із `bg_mode = "transparent"` без явного формату з підтримкою альфа-каналу (наприклад, оригінал `.jpg`)
- **THEN** результат кодується у `png` зі збереженням прозорості

#### Scenario: GPU inference concurrency is bounded while CPU resize scales
- **WHEN** паралельно надходять задачі обробки або клієнт опитує список файлів під час інференсу
- **THEN** GPU/ONNX-задачі (`upscale`, `enhance`, `remove_bg`, `blur_bg`) обмежуються семафором (`Semaphore(1)`), `resize` виконується в `ThreadPoolExecutor`, а основний IPC-цикл лишається чутливим до `app.ping` та `studio.list_files`

### Requirement: Batch ZIP Export from Output Directory
Опкод `studio.download_zip` MUST архівувати всі оброблені файли з `<working_dir>/output/` у `.zip` і повертати бінарний payload напряму.

#### Scenario: Download ZIP packages all processed images
- **WHEN** в `output/` є один або кілька оброблених файлів і клієнт викликає `studio.download_zip`
- **THEN** воркер формує валідний ZIP-архів із цими файлами та повертає його байти бінарним фреймом
