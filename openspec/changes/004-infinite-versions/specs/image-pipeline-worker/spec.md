# Spec Delta

## MODIFIED Requirements

### Requirement: Non-Destructive File Storage and Processing Chaining
Воркер MUST зберігати оригінальні завантажені зображення незмінними в корені робочої директорії (`JETPACK_APP_HOME`), зберігати всі результати обробки у версійованих підпапках `<working_dir>/output/<stem>/<stem>-v<NNN>.<ext>` (де `NNN` — тризначний або довший монотонний лічильник `001`, `002`, `003`, …), використовувати поточну обрану активну версію (оригінал або конкретну `vNNN`) як вхідне джерело для наступної операції та зберігати всі попередні проміжні версії на диску при послідовній обробці чи зміні вихідного формату.

#### Scenario: Sequential tool chaining preserves original and updates output
- **WHEN** користувач обробляє файл `my-image-1.jpg` інструментом `remove_bg`, а потім застосовує `blur_bg` або `resize`
- **THEN** оригінальний `my-image-1.jpg` у робочій директорії залишається незмінним, перша операція створює `<working_dir>/output/my-image-1/my-image-1-v001.png`, а друга бере на вхід `my-image-1-v001.png` і створює `<working_dir>/output/my-image-1/my-image-1-v002.<ext>`, оновлюючи активний вихідний результат і зберігаючи `v001` на диску

#### Scenario: Switching output format replaces stale output for the same stem
- **WHEN** для `photo.png` активним результатом є `<working_dir>/output/photo/photo-v001.png`, а наступна операція записується з `output_format = "webp"`
- **THEN** воркер створює `<working_dir>/output/photo/photo-v002.webp`, перемикає активний вихідний результат із `v001` (`png`) на `v002` (`webp`) і водночас зберігає попередню версію `photo-v001.png` в історії версій

#### Scenario: Processing from an earlier version or original appends next monotonic version without overwriting sibling versions
- **WHEN** для `my-image-1.jpg` існують версії `v001`, `v002` і `v003`, а користувач обирає активною версією `v001` (або `original`) і запускає нову операцію обробки
- **THEN** воркер бере на вхід обрану версію, створює новий файл `my-image-1-v004.<ext>`, встановлює `v004` новою активною версією та залишає `v001`, `v002` і `v003` недоторканими

#### Scenario: Version counter remains monotonic after intermediate version deletion
- **WHEN** для `my-image-1.jpg` існують `v001`, `v002` і `v003`, користувач видаляє `v002`, а потім виконує нову обробку
- **THEN** воркер створює `my-image-1-v004.<ext>` (не перевикористовуючи видалений номер `v002` і не перезаписуючи `v003`)

#### Scenario: Restore removes processed files without touching originals
- **WHEN** викликається `studio.restore` для одного файлу або з прапором `restore_all = true`
- **THEN** усі проміжні версії та підпапка `<working_dir>/output/<stem>/` (або всі підпапки в `output/`) видаляються, `version_count` стає `1`, `is_processed` стає `false`, а файли-оригінали залишаються недоторканими

### Requirement: Batch ZIP Export from Output Directory
Опкод `studio.download_zip` MUST рекурсивно архівувати всі проміжні оброблені версії з усіх підпапок `<working_dir>/output/<stem>/<stem>-v<NNN>.<ext>` у `.zip` зі збереженням структури папок `<stem>/<stem>-v<NNN>.<ext>` і повертати бінарний payload напряму.

#### Scenario: Download ZIP packages all processed images
- **WHEN** у `output/` містяться `my-image-1/my-image-1-v001.jpg`, `my-image-1/my-image-1-v002.png` і `hero/hero-v001.webp`, та клієнт викликає `studio.download_zip`
- **THEN** воркер формує валідний ZIP-архів із записами `my-image-1/my-image-1-v001.jpg`, `my-image-1/my-image-1-v002.png` та `hero/hero-v001.webp` (`file_count = 3`) і повертає його байти бінарним фреймом

## ADDED Requirements

### Requirement: Infinite Version Listing, Retrieval, Deletion, and Active Base Selection
Воркер MUST повертати повний список версій для кожного файлу (від `original` та всіх `vNNN` у `output/<stem>/`) із зазначенням поточної активної робочої версії, підтримувати завантаження байтів і прев'ю будь-якої конкретної версії через `studio.get_image`, перемикання активної версії без видалення історії та видалення будь-якої довільної проміжної версії.

#### Scenario: File listing includes all intermediate versions and persisted active version
- **WHEN** у `output/my-image-1/` збережено `my-image-1-v001.jpg` та `my-image-1-v002.png` і активною версією обрано `v001`
- **THEN** `studio.list_files` повертає для `my-image-1.jpg` список `versions` з усіх наявних версій (`original`, `v001`, `v002`) з їхніми розмірами, форматом, обсягом та технічними метаданими, `active_version_id = "v001"`, а також актуальний стан `is_processed` і розміри активної версії

#### Scenario: Get image retrieves specific version or active version bytes
- **WHEN** клієнт викликає `studio.get_image` із параметром `version_id` (наприклад `"v001"`) або без нього
- **THEN** воркер повертає бінарні байти запитаної версії (або поточної активної обробленої версії, якщо `version_id` не вказано) разом з оригіналом у єдиному zero-copy фреймі

#### Scenario: Selecting active version persists across list refreshes without deleting other versions
- **WHEN** клієнт викликає опкод вибору активної версії (`studio.select_version`) з `version_id = "original"` або `"v001"`
- **THEN** воркер оновлює активну версію для файлу без видалення жодних файлів у `output/<stem>/` і повертає оновлений запис файлу

#### Scenario: Deleting an intermediate version removes only that file and updates active pointer safely
- **WHEN** клієнт викликає видалення версії (`studio.delete_version`) для `v002`, коли існують `v001`, `v002` і `v003`
- **THEN** воркер видаляє лише файл `my-image-1-v002.<ext>`, а якщо видалена версія була активною — перемикає активну версію на найближчу попередню/останню наявну версію (або на `original`, якщо інших оброблених версій не залишилося, видаляючи порожню папку `output/<stem>/`)

#### Scenario: Deleting the base original version is rejected
- **WHEN** клієнт намагається видалити версію `original` через `studio.delete_version`
- **THEN** воркер відхиляє запит з `system.error` та залишає оригінал недоторканим

### Requirement: Undo Last Processing Action With Physical File Cleanup
Воркер MUST підтримувати багатокроковий стек `Undo` (`studio.undo`) для виконаних операцій обробки (`studio.process`), який при скасуванні останньої дії фізично видаляє з диска всі версійні файли, створені цією дією (як для одного файлу, так і для всього пакета `Process All`), та відновлює попередні активні версії відповідних файлів.

#### Scenario: Undo after single-file processing deletes the created version file and restores prior active version
- **WHEN** користувач виконав `studio.process` для `my-image-1.jpg` (активна була `v001`, створилась `v002`) і викликає `studio.undo`
- **THEN** воркер фізично видаляє `output/my-image-1/my-image-1-v002.<ext>`, відновлює `active_version_id = "v001"` і повертає оновлений список/стан файлів без залишкових файлів на диску

#### Scenario: Undo after batch Process All deletes all versions created in that batch
- **WHEN** користувач виконав `studio.process` для `a.jpg` та `b.png` в одному пакетному запуску (створились `a-v001.jpg` і `b-v002.png`) і викликає `studio.undo`
- **THEN** воркер видаляє обидва створені файли (`a-v001.jpg` і `b-v002.png`), видаляє порожню папку `output/a/` за відсутності інших версій, відновлює попередні активні версії обох файлів та підтримує подальший виклик `studio.undo` для попередньої дії в стеку
