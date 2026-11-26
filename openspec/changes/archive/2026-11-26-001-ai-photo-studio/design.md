# Design: AI Photo Studio (`dev.codingbro.ai-photo-studio`)

## Context

Стартовий репозиторій містить каркас JetPack-воркера (`app.toml`, `worker.py`, `src/main.ts`, `src/jetpack-env.d.ts`, `AGENTS.md`). Платформа JetPack парсить `app.toml` із `#[serde(deny_unknown_fields)]`, роздає зібраний інтерфейс із директорії `<app_dir>/ui/` за маршрутом `/apps/<app_id>/`, вимагає `dev.codingbro.ai-photo-studio` для локальних збірок і при наявності `[volumes.*]` обов'язково блокує запуск воркера на нативний системний діалог вибору папки (поле `optional` у схемі `VolumeMount` відсутнє).

Тому робочою папкою проєкту за замовчуванням слугує ізольована директорія `JETPACK_APP_HOME` (`client.app_home`), а додавання зображень у неї здійснюється через Drag&Drop або браузерний вибір файлів/директорії без блокування старту застосунку.

## Goals / Non-Goals

**Goals:**
- Забезпечити повністю автономне пакування воркера + веб-інтерфейсу у єдиний OCI-бандл через `jetpack package`.
- Гарантувати недеструктивну обробку: оригінали в `JETPACK_APP_HOME` ніколи не перезаписуються, а послідовні інструменти автоматично формують ланцюжок поверх останнього результату з `output/`.
- Використовувати zero-copy бінарний обмін (`Uint8Array` у TypeScript, `memoryview` у Python) без base64-кодування у метаданих.
- Підтримувати сувору типізацію контрактів через `@opcode` + Pydantic + `jetpack codegen` + `tsc --noEmit`.
- Захистити GPU/ONNX-інференс від OOM на 8–16 GB VRAM за допомогою семафора (`Semaphore(1)`), не блокуючи при цьому IPC-канал опитування та прогресу.

**Non-Goals:**
- Додавання нативних `[volumes]` у `app.toml` (свідомо виключено, щоб не блокувати запуск при скасуванні діалогу ОС).
- Навчання чи дотренування моделей користувачем.
- Багатокористувацька синхронізація чи хмарне сховище.

## Decisions

### 1. Конфігурація `app.toml` і кешування моделей
- `package.id = "dev.codingbro.ai-photo-studio"`, `version = "0.1.0"`.
- `[hardware]`: `min_ram_mb = 2048`, `min_vram_mb = 0`, `min_disk_mb = 1024`, `accelerators = ["metal", "cuda", "cpu"]`, `architectures = ["darwin/arm64", "linux/amd64", "windows/amd64"]`.
- `[python_env]`: `python_version = "3.12"`, `isolated = true`, залежності: `jetpack-sdk`, `pydantic`, `msgpack`, `pillow`, `numpy`, `spandrel`, `torch`, `torchvision`, `rembg[cpu]`, `onnxruntime` (та `[python_env.backend_indexes]` для `cuda`/`cpu` PyTorch wheels).
- `[permissions]`:
  - `gpu_access = true`
  - `model_cache = true` (daemon монтує `<root>/cache/models` RW і передає `JETPACK_MODEL_CACHE_DIR`, `HF_HOME`, `TORCH_HOME`)
  - `filesystem_scopes = []`
  - `network_allowlist = ["preset:huggingface", "github.com:443", "objects.githubusercontent.com:443", "release-assets.githubusercontent.com:443"]`
- У `pipeline.py` при старті виставляються `U2NET_HOME = <JETPACK_MODEL_CACHE_DIR>/u2net` та підпапка `<JETPACK_MODEL_CACHE_DIR>/spandrel`, щоб жодні ваги не потрапляли поза кеш-директорію JetPack.

### 2. Протокол фреймів (MsgPack Metadata + Zero-Copy Binary)
- **Вхідні запити (`JetPackAppClient.request(opcode, meta, binaryPayload)`):** `jetpack-wasm` (`encode_worker_frame`) формує payload як конкатенацію `MsgPack(meta) + raw_payload` без додаткового 4-байтового префікса. У `worker.py` допоміжний декодер зчитує перший MsgPack-об'єкт (через `msgpack.Unpacker` або offset-парсер) і бере `memoryview(frame.payload)[offset:]` як zero-copy бінарний буфер.
- **Відповіді та стріми від воркера (`studio.get_image`, `studio.download_zip`, `studio.list_files`, `studio.process.progress`):**
  - Для чисто метаданих / списків повертається UTF-8 JSON або MsgPack із чітким форматом конверта `[4-byte uint32 LE meta_len] + [UTF-8 JSON meta] + [raw binary bytes]`.
  - Це дозволяє фронтенду через `DataView` і `payload.subarray(4 + metaLen)` миттєво створювати `Blob` / `URL.createObjectURL(...)` без копіювання чи `base64`.

### 3. Контракт опкодів (`worker.py` + `jetpack codegen`)
Усі публічні опкоди анотуються `@opcode(...)` з Pydantic-моделями:
- `studio.list_files`: повертає список файлів `{ files: StudioFileEntry[], processed_count: number, working_dir: string }` і в бінарній частині — упаковані мініатюри (або окремі офсети/довжини у метаданих для zero-copy `subarray` на клієнті).
- `studio.upload_files` (`binary=True`): `meta = { filename, overwrite }`, `binaryPayload = Uint8Array` сирих байтів зображення; валідує розширення й декодованість через `Pillow` і зберігає `<working_dir>/<safe_filename>`.
- `studio.get_image`: `meta = { filename, variant: "original" | "output" | "both" }`; повертає оригінальні та/або оброблені байти (для слайдера «До / Після» або `Download`) без `base64`.
- `studio.process`: `meta = { filenames, tool, params, output_format, job_id }`; запускає обробку у фоновому потоці, емітить потокові фрейми `studio.process.progress` (`stream=True`) та повертає фінальний результат `StudioProcessResult`.
- `studio.restore`: `meta = { filename?, restore_all }`; видаляє файл(и) з `output/`.
- `studio.download_zip`: формує `.zip` усіх файлів з `output/` у `BytesIO`/тимчасовому файлі та повертає raw ZIP bytes у бінарній секції відповіді.
- `app.ping`, `worker.ping`, `app.terminate`, `worker.stop`: системні опкоди життєвого циклу JetPack.

### 4. Недеструктивний ланцюжок обробки (`pipeline.py`)
- Коренева директорія: `JETPACK_APP_HOME` (з можливістю перевизначення в юніт-тестах через `working_dir` аргумент класу пайплайну).
- Підтримувані розширення (case-insensitive): `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`.
- Сканер ігнорує `output/`, будь-які директорії, приховані файли (`name.startswith(".")`), симлінки та непідтримувані розширення.
- Мапінг результату: для `<stem>.<orig_ext>` шукається активний файл `<working_dir>/output/<stem>.*`.
  - Якщо файл у `output/` існує — наступний інструмент бере на вхід саме його.
  - Інакше — береться оригінал `<working_dir>/<stem>.<orig_ext>`.
  - Після запису нового результату `<working_dir>/output/<stem>.<new_ext>` попередні файли `<stem>.*` в `output/` із іншим розширенням видаляються (атомарний запис через тимчасовий файл + `os.replace`).

### 5. AI-інструменти та конкурентність
- **`upscale`** (`scale: 2 | 4`): моделі `RealESRGAN_x2plus.pth` / `RealESRGAN_x4plus.pth` завантажуються через `spandrel.ModelLoader(device=...)` (`mps` на Apple Silicon якщо доступний і стабільний, `cuda` на NVIDIA, інакше `cpu`). Для великих зображень використовується тайлінг (tiled inference із overlap), щоб уникнути OOM.
- **`enhance`**: легка 1x-модель через `spandrel` (наприклад, `1x-ITF-SkinDiffDetail-Lite` або `RealESRGAN_x2plus` + високоякісний `Pillow` LANCZOS downscale до 1x із легким denoise/sharpen fallback при недоступності мережі).
- **`remove_bg`** (`bg_mode: "transparent" | "color"`, `bg_color: "#RRGGBB"`): `rembg` (`isnet-general-use` або `u2net`) із пріоритетом ONNX Runtime провайдерів `["CUDAExecutionProvider", "CoreMLExecutionProvider", "CPUExecutionProvider"]` (фільтрованим за `onnxruntime.get_available_providers()`). При `bg_mode == "transparent"` вихід примусово кодується у `png` (або `webp`, якщо користувач явно обрав `webp`); при `bg_mode == "color"` альфа-маска композититься поверх суцільного кольору `bg_color`.
- **`blur_bg`** (`level: 1..100`): маска переднього плану з `rembg` + розмиття фону `ImageFilter.GaussianBlur(radius=...)` + плавний композитинг через альфа-маску (`Image.composite`).
- **`resize`** (`width`, `height`, `keep_aspect`): `Image.Resampling.LANCZOS` у `ThreadPoolExecutor`.
- **Конкурентність**:
  - `self._gpu_semaphore = threading.Semaphore(1)` охоплює AI-інференс (`upscale`, `enhance`, `remove_bg`, `blur_bg`).
  - `self._cpu_pool = ThreadPoolExecutor(max_workers=min(4, os.cpu_count() or 2))` обслуговує CPU-інструмент (`resize`), генерацію мініатюр та ZIP-архівацію.
  - Захист `client.send_frame(...)` уже забезпечений внутрішнім `_write_lock` у `JetPackClient`, але для пакетних операцій прогрес відправляється безпечно з фонового потоку.

### 6. Веб-інтерфейс (`src/` -> `ui/`) і збірка Vite
- Vite конфігурується з `base: "./"` та `build.outDir = "ui"`, `build.emptyOutDir = true`, щоб при збірці створювалися `ui/index.html` і `ui/assets/*` без симлінків і без `node_modules` усередині `ui/`.
- Для `JetPackAppClient.connectAndEnsureApp` у Vite-бандлі імпортується локальний/пакетний адаптер `jetpack-wasm` (копія або залежність `jetpack-wasm` у `package.json` без симлінків у `ui/`).
- `JetPackControlBar` ініціалізується з `appName: "AI Photo Studio"`, `warnOnUnsavedWork: () => controller.isProcessing`, повідомленням про ризик переривання активної обробки.
- Компоновка:
  - Ліва панель (1/3 ширини, Dark Frosted Glass картка): зона Drag&Drop + клік по порожньому простору (прихований `<input type="file" multiple accept="image/*">` та підтримка вибору папки через `webkitdirectory` для швидкого імпорту), список файлів (мініатюра, назва, бейдж `Оброблено`), кнопка у правому верхньому куті шапки списку з циклом `Select` -> `Select All` -> `Reset` -> `Select`.
  - Права панель (2/3 ширини):
    - Верхній горизонтальний тулбар (висота 168px): 5 кнопок інструментів зліва направо + динамічний блок параметрів + селектор `File Type` (`Original (auto)`, `PNG`, `JPG`, `WEBP`) + справа кнопки `Process` і `Process All`.
    - Полотно перегляду:
      - Якщо вибрано 1 файл і `is_processed`: інтерактивний Before/After split-slider (перетягування ручки + клік + клавіатурні стрілки).
      - Якщо в режимі `Select` вибрано >= 2 файлів: каскад слайдів у стилі Apple Time Machine (`perspective` + `translateZ` / `translateX` / `scale` / `opacity` для задніх карток, клік по задній картці виводить її вперед або перемикає перегляд).
      - Прогрес-оверлей під час виконання.
      - На активному обробленому зображенні — плаваючі кнопки `Download` та `Restore`.
      - У правому нижньому куті робочої області — кнопки `Download All` і `Restore All`.

## Risks / Trade-offs

- **Перше завантаження ваг моделей:** Real-ESRGAN та `rembg` ваги мають розмір ~60–180 MB; перше виконання AI-інструменту триватиме довше через завантаження у `JETPACK_MODEL_CACHE_DIR`. *Мітігація:* надсилати детальний етап прогресу (`downloading_model`, `loading_model`, `processing`) у стрімі `studio.process.progress`.
- **Обсяг PyTorch/ONNX залежностей у локальному `.venv`:** ізольоване `uv`-середовище потребує достатньо місця на диску. *Мітігація:* виставити реалістичний `min_disk_mb` та `min_ram_mb` в `app.toml`.
- **Великі бандли `studio.list_files` при сотнях фото:** пакування всіх мініатюр в один фрейм може рости лінійно. *Мітігація:* генерувати легкі WebP/JPEG мініатюри (макс. 160x160, ~5–10 KB кожна) або завантажувати їх ледаче батчами.
- **Відсутність `[volumes]` у `app.toml`:** користувач не монтує довільну папку на хості напряму в sandbox, але зате запуск воркера ніколи не блокується і не падає при скасуванні системного діалогу, а Drag&Drop + вибір файлів/папки в браузері працює миттєво.
