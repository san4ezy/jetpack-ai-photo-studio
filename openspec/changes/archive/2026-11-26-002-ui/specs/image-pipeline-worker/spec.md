# image-pipeline-worker Spec Delta

## ADDED Requirements

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

### Requirement: Aspect-Ratio Cover Fit Mode and Custom Crop Region in Resize
Інструмент `resize` MUST підтримувати опціональний параметр `fit_mode` (`"contain" | "cover" | "stretch"`) та нормалізовану область кадрування (`crop_x`, `crop_y`, `crop_w`, `crop_h` у діапазоні `[0..1]`), щоб усі режими співвідношень сторін (`1:1`, `4:5`, `9:16`, `16:9`, `4:3`, `3:2`, `Custom`) обрізали зображення пропорційно до точних цільових розмірів без спотворення пропорцій.

#### Scenario: Cover fit mode center-crops image to exact target aspect dimensions
- **WHEN** клієнт викликає `studio.process` із `tool = "resize"`, заданими `width` і `height` та `fit_mode = "cover"` без явного `crop_x`/`crop_y`/`crop_w`/`crop_h`
- **THEN** воркер центрує і пропорційно кадрує зображення (`ImageOps.fit`) до точних розмірів `width × height` без розтягування

#### Scenario: Explicit normalized crop region is applied proportionally before scaling
- **WHEN** клієнт викликає `studio.process` із `tool = "resize"`, `fit_mode = "cover"` та валідними `crop_x`, `crop_y`, `crop_w`, `crop_h`
- **THEN** воркер спочатку кадрує зазначену прямокутну область зображення, а потім масштабує її до точних цільових розмірів `width × height` без спотворення пропорцій
