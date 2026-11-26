# image-pipeline-worker Spec Delta

## ADDED Requirements

### Requirement: Rich Image Metadata Extraction for File Inspection
Воркер MUST витягувати з файлів зображень у робочій директорії та `output/` додаткові технічні метадані (DPI по осях X/Y, колірний режим зображення та джерело файлу) і повертати їх у структурі `StudioFileEntry` для відображення в інспекторі деталей файлу.

#### Scenario: File listing and processing include DPI, color mode, and source metadata
- **WHEN** клієнт викликає `studio.list_files`, `studio.upload_files` або `studio.process`
- **THEN** кожен `StudioFileEntry` містить `dpi_x`, `dpi_y` (якщо присутні у метаданих зображення), `color_mode`, `source` (`"workspace"` для файлів у корені робочої директорії), а для оброблених файлів також `output_dpi_x`, `output_dpi_y` та `output_color_mode`
