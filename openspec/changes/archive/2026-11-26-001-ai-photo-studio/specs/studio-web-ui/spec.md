# Spec Delta: Studio Web UI

## Purpose
Визначає користувацький інтерфейс AI Photo Studio (`src/` -> `ui/`) у стилістиці JetPack Dark Frosted Glass: ліву панель віртуальної папки проєкту (1/3 ширини), верхній тулбар інструментів, інтерактивне полотно зі слайдером «До / Після» та каскадом мульти-виділення, і панель завантаження/відновлення результатів.

## ADDED Requirements

### Requirement: Two-Column Dark Frosted Glass Layout
Інтерфейс MUST відповідати темній напівпрозорій стилістиці JetPack (`backdrop-filter: blur`, темний фон, тонкі напівпрозорі рамки) і поділятися на ліву панель файлів (1/3 ширини) та праву робочу область (2/3 ширини) під верхньою `JetPackControlBar`.

#### Scenario: Desktop layout maintains 1/3 to 2/3 split
- **WHEN** застосунок відкривається на десктопному екрані
- **THEN** ліва панель займає ~1/3 ширини (мін. ~300px), а права робоча область займає 2/3 ширини з верхньою панеллю інструментів висотою 150–200px

### Requirement: Virtual Project Folder Panel and Three-State Selection Toggle
Ліва панель MUST підтримувати завантаження зображень через Drag&Drop або клік по порожньому місцю (браузерний вибір файлів/папки), показувати мініатюри, імена, бейдж «Оброблено» та мати компактну кнопку-перемикач станів виділення.

#### Scenario: Drag and drop or click empty space uploads images
- **WHEN** користувач перетягує зображення на ліву панель або клікає по її порожній області та обирає файли
- **THEN** фронтенд надсилає валідні зображення через `studio.upload_files` і оновлює список мініатюр

#### Scenario: Selection toggle cycles Select -> Select All -> Reset
- **WHEN** користувач послідовно натискає кнопку режиму виділення у шапці лівої панелі
- **THEN** у стані `Select` вмикається режим мульти-виділення і кнопка стає `Select All`; наступний клік виділяє всі файли й переводить кнопку в `Reset`; наступний клік скидає виділення і повертає кнопку в `Select`

### Requirement: Top Horizontal Toolbar and Processing Actions
Верхня панель інструментів (150–200px) MUST містити 5 інструментів зліва направо (`Upscale`, `Enhance`, `Remove Background`, `Blur Background`, `Resize`), контекстні параметри обраного інструменту, спільний селектор `File Type` (`png`, `jpg`, `webp`) та кнопки `Process` і `Process All` праворуч.

#### Scenario: Selecting each tool updates dynamic option controls
- **WHEN** користувач перемикає інструмент у тулбарі
- **THEN** показуються відповідні опції: `2x / 4x` для `Upscale`; без додаткових опцій для `Enhance`; `Transparent / Color` + color picker для `Remove Background`; повзунок `Level` (`1..100`) для `Blur Background`; поля `Width` / `Height` зі збереженням пропорцій для `Resize`

#### Scenario: Process and Process All respect active and selected state
- **WHEN** у режимі `Select` не виділено жодного файлу
- **THEN** кнопка `Process All` є неактивною (`disabled`), а кнопка `Process` обробляє поточний верхній/активний файл

### Requirement: Interactive Preview Canvas with Before/After Slider and Time Machine Cascade
Полотно перегляду MUST відображати інтерактивний слайдер «До / Після» для обробленого одиничного зображення та каскад слайдів у стилі Apple Time Machine при мульти-виділенні кількох файлів.

#### Scenario: Single processed image renders interactive Before/After slider
- **WHEN** обрано один файл зі статусом `is_processed = true`
- **THEN** полотно завантажує оригінал та оброблену версію через `studio.get_image` і рендерить рухомий вертикальний розділювач «До / Після» з підтримкою миші/тач-подій

#### Scenario: Multi-selection renders Apple Time Machine cascade
- **WHEN** у режимі виділення обрано 2 або більше файлів
- **THEN** перший виділений файл відображається спереду, а наступні виділені файли формують перспективний каскад позаду нього, із можливістю кліку для перегляду або обробки всієї вибірки через `Process All`

### Requirement: Individual and Batch Result Controls
Користувач MUST мати змогу завантажити або відновити як окреме оброблене зображення (кнопки на полотні), так і всі результати одразу (кнопки у правому нижньому куті).

#### Scenario: Per-image Download and Restore appear on processed image
- **WHEN** активне зображення на полотні є обробленим
- **THEN** поверх зображення відображаються кнопки `Download` (скачує результат із `output/`) та `Restore` (викликає `studio.restore` для цього файлу і повертає оригінал)

#### Scenario: Bottom-right Download All and Restore All reflect processed count and busy state
- **WHEN** у `output/` немає жодного обробленого файлу або триває обробка
- **THEN** кнопки `Download All` і `Restore All` у правому нижньому куті робочої області є неактивними (`disabled`), а за наявності результатів і простою `Download All` скачує `.zip` архів через `studio.download_zip`, тоді як `Restore All` очищає всі результати
