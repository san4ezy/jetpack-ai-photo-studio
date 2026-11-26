# Proposal: AI Photo Studio (`dev.codingbro.ai-photo-studio`)

## Why

Платформі JetPack потрібен повноцінний автономний застосунок локальної AI-обробки зображень **AI Photo Studio** (`dev.codingbro.ai-photo-studio`), який поєднує ізольований Python-воркер із GPU/CPU-інференсом (`spandrel`, `rembg`, `torch`, `Pillow`) та веб-інтерфейс на TypeScript + Vite + `@jetpack/client`, зібраний у єдиний OCI-пакет (`jetpack package`). Зараз у репозиторії наявний лише базовий шаблон воркера (`worker.py` із `ping`/`echo`) та порожній `src/main.ts` без UI, AI-пайплайну й файлового сховища.

## What Changes

- Налаштувати маніфест [`app.toml`](../../../app.toml) під реальні вимоги AI Photo Studio: Python 3.12 (`jetpack-sdk`, `pydantic`, `msgpack`, `pillow`, `numpy`, `spandrel`, `torch`, `torchvision`, `rembg[cpu]`, `onnxruntime`), `permissions.gpu_access = true`, `permissions.model_cache = true`, обмежений `network_allowlist` (`preset:huggingface` та GitHub Releases/CDN для першого завантаження ваг моделей) і без оголошення `[volumes]` (робота у віртуальній ізольованій директорії `JETPACK_APP_HOME` без блокування запуску нативним діалогом ОС).
- Реалізувати бекенд-воркер [`worker.py`](../../../worker.py) та AI-пайплайн `pipeline.py` з non-destructive chaining (оригінали в `JETPACK_APP_HOME` незмінні, результати зберігаються в `<working_dir>/output/<stem>.<ext>`, повторна обробка бере на вхід уже оброблену версію з `output/`), zero-copy бінарними опкодами (`studio.list_files`, `studio.upload_files`, `studio.get_image`, `studio.process`, `studio.restore`, `studio.download_zip`), потоковим прогресом і конкурентним захистом GPU семафором (`Semaphore(1)`).
- Згенерувати типізовані контракти `src/jetpack-env.d.ts` через `jetpack codegen` і побудувати веб-інтерфейс на TypeScript + Vite (`ui/index.html`, `ui/assets/*`) у стилістиці JetPack Dark Frosted Glass із `JetPackAppClient` та `JetPackControlBar` (`warnOnUnsavedWork`), лівою панеллю Drag&Drop / вибору файлів та 3-становим перемикачем `Select -> Select All -> Reset`, верхньою панеллю інструментів (`Upscale`, `Enhance`, `Remove Background`, `Blur Background`, `Resize`), полотном зі слайдером «До / Після» і каскадом у стилі Apple Time Machine, а також керуванням результатами (`Download`, `Restore`, `Download All`, `Restore All`).
- Додати юніт-тести Python (`unittest`), тести TypeScript/фронтенду та перевірку `jetpack validate app.toml` і `jetpack package`.

## Capabilities

### New Capabilities
- `jetpack-app-integration`: Конфігурація `app.toml`, кешування моделей у `JETPACK_MODEL_CACHE_DIR`, збірка Vite у `ui/` для роздачі через `jetpack-daemon` (`/apps/dev.codingbro.ai-photo-studio/`), підключення через `JetPackAppClient<JetPackOpcodeMap>`, `JetPackControlBar` та пакування в OCI-бандл.
- `image-pipeline-worker`: Недеструктивний файловий конвеєр (`JETPACK_APP_HOME` + `output/`), фільтрація зображень, типізовані бінарні опкоди з zero-copy `memoryview`, потоковий прогрес, 5 AI/графічних інструментів (`upscale`, `enhance`, `remove_bg`, `blur_bg`, `resize`), GPU-семафор і ZIP-експорт.
- `studio-web-ui`: Веб-інтерфейс Dark Frosted Glass із двоколонковою компоновкою (1/3 віртуальна папка + 2/3 робоча область), 3-становою кнопкою виділення, верхнім тулбаром параметрів, інтерактивним слайдером «До / Після», каскадом мульти-виділення (Apple Time Machine) та індивідуальним/пакетним завантаженням і відновленням.

### Modified Capabilities
- Немає (новий застосунок у порожньому стартовому репозиторії).

## Impact

- Зачіпає файли: [`app.toml`](../../../app.toml), [`pyproject.toml`](../../../pyproject.toml), [`package.json`](../../../package.json), [`tsconfig.json`](../../../tsconfig.json), [`worker.py`](../../../worker.py), нові модулі `pipeline.py`, `src/*`, конфігурацію Vite, вихідну директорію `ui/` та набори тестів у `tests/`.
- Зовнішні залежності: PyPI-пакети (`spandrel`, `torch`, `torchvision`, `rembg`, `onnxruntime`, `pillow`, `numpy`, `pydantic`, `msgpack`), npm-пакети (`vite`, `@jetpack/client`, `jetpack-wasm`).
- Безпека та ізоляція: суворе дотримання `#[serde(deny_unknown_fields)]`, відсутність симлінків у бандлі, заборона обходу `JETPACK_APP_HOME` (path traversal protection), кешування ваг лише у `JETPACK_MODEL_CACHE_DIR` / `HF_HOME` / `TORCH_HOME` / `U2NET_HOME`.
