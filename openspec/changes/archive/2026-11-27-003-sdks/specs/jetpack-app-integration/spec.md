# Spec Delta

## ADDED Requirements

### Requirement: Published Registry SDK Dependencies Without Monorepo Coupling
Проєкт MUST використовувати опубліковані реєстрові пакети `jetpack-sdk` (PyPI) у Python-воркері та `@jetpack-desktop/client` (npm) у фронтенді без жодних локальних залежностей на сусідній монорепозиторій `../../jetpack` (`file:`-залежності в `package.json` або інжекція `sys.path` у `worker.py`).

#### Scenario: Frontend builds cleanly in standalone checkout using npm registry SDK
- **WHEN** у проєкті відсутня локальна директорія `../../jetpack` та виконуються `npm ci` (або `npm install`) і `npm run build`
- **THEN** `package.json` містить лише реєстрову залежність `@jetpack-desktop/client` (без локальної `jetpack-wasm` `file:`-залежності), а `tsc --noEmit && vite build` успішно компілює бандл у `ui/` з вбудованим WASM із `@jetpack-desktop/client`

#### Scenario: Worker imports published PyPI jetpack-sdk without local path override
- **WHEN** запускається `worker.py` або виконуються Python unit-тести у `.venv` навіть за наявності на диску сусідньої папки `../../jetpack/sdks/python`
- **THEN** `worker.py` не модифікує `sys.path` локальними шляхами монорепозиторію, а імпортує `jetpack_sdk` виключно з встановленого пакета `jetpack-sdk` згідно з узгодженими специфікаторами в `pyproject.toml` та `app.toml`

## MODIFIED Requirements

### Requirement: Authenticated Client Connection and Typed Opcode Contract
Браузерний клієнт MUST імпортувати `JetPackAppClient` із опублікованого npm-пакета `@jetpack-desktop/client`, підключатися виключно через `JetPackAppClient<JetPackOpcodeMap>().connectAndEnsureApp(...)` із використанням вбудованого в `@jetpack-desktop/client` WebAssembly-рушія без ручного підключення `jetpack-wasm`, монтувати `JetPackControlBar` і проходити перевірку типів `tsc --noEmit` за згенерованим `src/jetpack-env.d.ts`.

#### Scenario: Codegen and TypeScript check enforce opcode parity
- **WHEN** у `worker.py` змінюються Pydantic-моделі або `@opcode`-обробники та виконується `jetpack codegen --worker worker.py --out src/jetpack-env.d.ts` і `npx tsc --noEmit`
- **THEN** усі клієнтські виклики `client.request(...)` і підписки `client.onStream(...)` через `@jetpack-desktop/client` відповідають контрактам воркера на етапі компіляції

#### Scenario: Control bar warns before stopping during active processing
- **WHEN** користувач натискає `Stop` у `JetPackControlBar` під час активної обробки зображень
- **THEN** `warnOnUnsavedWork` повертає `true` і `JetPackControlBar` показує модальне підтвердження перед зупинкою воркера

#### Scenario: Zero-config WASM initialization via @jetpack-desktop/client
- **WHEN** `connectStudioClient` викликає `client.connectAndEnsureApp(...)`
- **THEN** клієнт не передає зовнішніх `wasmModule` або `wasmBinaryOrUrl`, покладаючись на автоматичне завантаження bundled WASM із `@jetpack-desktop/client` у dev-режимі Vite та у production-збірці `ui/`
