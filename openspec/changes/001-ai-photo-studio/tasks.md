# Tasks

## 1. JetPack Manifest & Project Configuration

- [ ] 1.1 Оновити `app.toml` для `dev.codingbro.ai-photo-studio`: налаштувати `[hardware]`, `[python_env]` (`python_version = "3.12"`, `isolated = true`, залежності `jetpack-sdk`, `pydantic`, `msgpack`, `pillow`, `numpy`, `spandrel`, `torch`, `torchvision`, `rembg[cpu]`, `onnxruntime` + `[python_env.backend_indexes]`), `[permissions]` (`gpu_access = true`, `model_cache = true`, `filesystem_scopes = []`, `network_allowlist = ["preset:huggingface", "github.com:443", "objects.githubusercontent.com:443", "release-assets.githubusercontent.com:443"]`) без секції `[volumes]`.
- [ ] 1.2 Оновити `pyproject.toml` і `package.json` (додати `vite`, скрипти `dev`, `build`, `preview`, `typecheck`, `codegen`, `test`), налаштувати `vite.config.ts` із `base: "./"` та `build.outDir = "ui"`.
- [ ] 1.3 Переконатися у відсутності симлінків усередині робочої директорії бандлу (`ui/` та кореня застосунку) і провалідувати `app.toml` через `jetpack validate app.toml`.

## 2. Backend Worker & Non-Destructive Pipeline (`worker.py` + `pipeline.py`)

- [ ] 2.1 Реалізувати у `pipeline.py` менеджер робочої директорії (`JETPACK_APP_HOME`), path-traversal валідатор, фільтр підтримуваних форматів (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tiff`) з ігноруванням `output/`, прихованих файлів і симлінків.
- [ ] 2.2 Реалізувати non-destructive chaining: збереження результатів у `<working_dir>/output/<stem>.<ext>`, читання з `output/` при повторній обробці, видалення застарілих розширень того ж `<stem>`, атомарний запис і `restore` / `restore_all`.
- [ ] 2.3 Реалізувати налаштування кешу моделей (`JETPACK_MODEL_CACHE_DIR`, `HF_HOME`, `TORCH_HOME`, `U2NET_HOME`) та вибір ONNX Runtime провайдерів (`CUDAExecutionProvider`, `CoreMLExecutionProvider`, `CPUExecutionProvider`) і PyTorch device (`cuda`, `mps`, `cpu`).
- [ ] 2.4 Реалізувати 5 інструментів обробки: `upscale` (`2x`/`4x` через `spandrel` із тайлінгом), `enhance` (1x покращення/різкість через `spandrel`), `remove_bg` (`rembg`, `transparent`/`color`), `blur_bg` (`rembg` маска + `Pillow` GaussianBlur композитинг), `resize` (`Pillow` LANCZOS зі збереженням пропорцій) і обробку `output_format` (`png`/`jpg`/`webp`).
- [ ] 2.5 Додати конкурентність (`threading.Semaphore(1)` для GPU/ONNX інференсу та `ThreadPoolExecutor` для CPU `resize`, мініатюр і ZIP) і реалізувати `create_output_zip()`.
- [ ] 2.6 Реалізувати у `worker.py` Pydantic-моделі, `@opcode` декоратори (`studio.list_files`, `studio.upload_files`, `studio.get_image`, `studio.process`, `studio.process.progress` stream, `studio.restore`, `studio.download_zip`, `app.ping`, `app.terminate`, `worker.stop`), декодування MsgPack-метаданих + zero-copy `memoryview` payload, а також генерацію `src/jetpack-env.d.ts` через `jetpack codegen --worker worker.py --out src/jetpack-env.d.ts`.

## 3. Web Frontend (`src/` -> `ui/`)

- [ ] 3.1 Реалізувати типізований транспортний шар (`src/wire.ts`) для zero-copy пакування/розпакування `[4B meta_len][meta][raw_bytes]` у `Blob` / `Uint8Array` та підключення через `JetPackAppClient<JetPackOpcodeMap>.connectAndEnsureApp(...)` з `JetPackControlBar` (`warnOnUnsavedWork`).
- [ ] 3.2 Реалізувати контролер стану (`src/studio-controller.ts`): список файлів, завантаження через Drag&Drop / file-input, 3-становий цикл виділення (`Select -> Select All -> Reset`), вибір інструменту і параметрів, запуск `Process` / `Process All`, обробка стріму прогресу, `Download`, `Restore`, `Download All` (`.zip`), `Restore All`.
- [ ] 3.3 Реалізувати Dark Frosted Glass UI (`index.html`, `src/styles.css`, `src/main.ts`): ліва панель (1/3 ширини) із Dropzone, мініатюрами, бейджем «Оброблено» і кнопкою виділення; права робоча область (2/3 ширини) з горизонтальним тулбаром (150–200px), динамічними опціями, селектором `File Type` і кнопками `Process` / `Process All`.
- [ ] 3.4 Реалізувати полотно перегляду: інтерактивний слайдер «До / Після» для одного обробленого зображення, каскад у стилі Apple Time Machine при мульти-виділенні, плаваючі кнопки `Download` / `Restore` поверх активного результату та кнопки `Download All` / `Restore All` у правому нижньому куті.

## 4. Verification, Tests & Packaging

- [ ] 4.1 Написати Python-тести (`tests/test_pipeline.py`, `unittest`) на non-destructive chaining, запис в `output/`, заміну розширень, `restore` / `restore_all`, фільтрацію типів файлів, захист від path traversal, ZIP-архівацію та розбір MsgPack+binary фреймів.
- [ ] 4.2 Написати фронтенд-тести (`tests/studio.test.mjs`) для перевірки 3-станового циклу `Select -> Select All -> Reset`, правил активності кнопок (`Process All`, `Download All`, `Restore All`), zero-copy парсингу бінарних конвертів і побудови payload.
- [ ] 4.3 Запустити повну перевірку: `jetpack codegen`, `npm run typecheck`, `npm run build` (у `ui/`), Python `unittest`, фронтенд-тести, `jetpack validate app.toml` і `jetpack package --out ./dist/oci-bundle .`.
