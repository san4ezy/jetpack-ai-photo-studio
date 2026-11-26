# Spec Delta: JetPack App Integration

## Purpose
Визначає правила інтеграції застосунку AI Photo Studio (`dev.codingbro.ai-photo-studio`) із маніфестом `app.toml`, пісочницею JetPack, кешем моделей `JETPACK_MODEL_CACHE_DIR`, роздачею фронтенду з `ui/` та типізованим RPC-з'єднанням через `@jetpack/client`.

## ADDED Requirements

### Requirement: Validated Sandboxed Manifest Configuration
Маніфест `app.toml` MUST бути валідним щодо суворої схеми JetPack (`#[serde(deny_unknown_fields)]`), використовувати локальний ідентифікатор `package.id = "dev.codingbro.ai-photo-studio"`, Python 3.12 в ізольованому `uv`-середовищі та мінімально необхідні дозволи.

#### Scenario: Manifest validation succeeds with AI dependencies and model cache
- **WHEN** розробник запускає `jetpack validate app.toml`
- **THEN** валідатор підтверджує коректність `[package]`, `[hardware]`, `[python_env]` (`python_version = "3.12"`, `isolated = true`), `[permissions]` (`gpu_access = true`, `model_cache = true`, `filesystem_scopes = []`, `network_allowlist` з `preset:huggingface`, `github.com:443`, `objects.githubusercontent.com:443`, `release-assets.githubusercontent.com:443`) і `[execution]` (`entrypoint = "worker.py"`) без невідомих полів

#### Scenario: Worker launches immediately without blocking on host folder picker
- **WHEN** `jetpack-daemon` запускає застосунок `dev.codingbro.ai-photo-studio`
- **THEN** маніфест не містить секції `[volumes]`, тому воркер не блокується на системний діалог вибору директорії ОС і використовує `JETPACK_APP_HOME` (`client.app_home`) як ізольовану робочу папку проєкту

### Requirement: Shared Model Cache Integration
Усі завантажувані ваги AI-моделей (`spandrel`, `torch`, `rembg` / `u2net` / `isnet` / `birefnet`) MUST зберігатися в директорії кешу моделей JetPack, а не всередині бандлу чи тимчасових шляхів.

#### Scenario: Model weights resolve to JETPACK_MODEL_CACHE_DIR subdirectories
- **WHEN** воркер ініціалізує пайплайн при виставленій змінній `JETPACK_MODEL_CACHE_DIR`
- **THEN** змінні середовища `HF_HOME`, `TORCH_HOME`, `U2NET_HOME` та каталог ваг `spandrel` спрямовуються у піддиректорії `JETPACK_MODEL_CACHE_DIR`

### Requirement: Standalone Web UI Bundling and Serving
Фронтенд на TypeScript + Vite MUST збиратися в директорію `ui/` (`ui/index.html`, `ui/assets/*`) з відносними шляхами ресурсів без симлінків і без `node_modules` усередині `ui/`, щоб `jetpack-daemon` роздавав його за `/apps/dev.codingbro.ai-photo-studio/` і пакував через `jetpack package`.

#### Scenario: OCI packaging includes built UI assets cleanly
- **WHEN** виконується збірка фронтенду (`npm run build`) і команда `jetpack package --out ./dist/oci-bundle .`
- **THEN** директорія `ui/` містить `index.html` та `assets/*` (включно з `jetpack_wasm` модулями), у директорії проєкту відсутні симлінки, а `jetpack package` успішно формує OCI Image Layout бандл

### Requirement: Authenticated Client Connection and Typed Opcode Contract
Браузерний клієнт MUST підключатися виключно через `JetPackAppClient<JetPackOpcodeMap>().connectAndEnsureApp(...)`, монтувати `JetPackControlBar` і проходити перевірку типів `tsc --noEmit` за згенерованим `src/jetpack-env.d.ts`.

#### Scenario: Codegen and TypeScript check enforce opcode parity
- **WHEN** у `worker.py` змінюються Pydantic-моделі або `@opcode`-обробники та виконується `jetpack codegen --worker worker.py --out src/jetpack-env.d.ts` і `npx tsc --noEmit`
- **THEN** усі клієнтські виклики `client.request(...)` і підписки `client.onStream(...)` відповідають контрактам воркера на етапі компіляції

#### Scenario: Control bar warns before stopping during active processing
- **WHEN** користувач натискає `Stop` у `JetPackControlBar` під час активної обробки зображень
- **THEN** `warnOnUnsavedWork` повертає `true` і `JetPackControlBar` показує модальне підтвердження перед зупинкою воркера
