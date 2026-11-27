# Proposal

## Why

Проєкт `ai-photo-studio` досі містить посилання на локальні монорепозиторні пакети (`@jetpack/client` у TypeScript-коді, `jetpack-wasm` через `file:../../jetpack/web/src/wasm/pkg` у `package.json` та `sys.path.insert` на `../../jetpack/sdks/python` у `worker.py`), через що `npm run build` наразі падає з помилкою `TS2307: Cannot find module '@jetpack/client'`, а середовище Python ізольовано не гарантує використання опублікованого пакета з PyPI. Тепер, коли офіційні SDK опубліковані на PyPI (`jetpack-sdk`) та npm (`@jetpack-desktop/client`), необхідно повністю перевести проєкт на ці зовнішні пакети, прибравши будь-які локальні залежності на сусідній монорепозиторій `../../jetpack`.

## What Changes

- Перевести всі фронтенд-імпорти з `@jetpack/client` на опублікований npm-пакет `@jetpack-desktop/client` (`src/wire.ts`, `src/main.ts`, `src/studio-controller.ts`).
- Видалити локальну файлову залежність `"jetpack-wasm": "file:../../jetpack/web/src/wasm/pkg"` із `package.json` (і `package-lock.json`) та прибрати ручний імпорт `wasmModule` / `wasmBinaryOrUrl` у `src/wire.ts`, використовуючи вбудований у `@jetpack-desktop/client` WebAssembly-бандл (`@jetpack-desktop/client/wasm`).
- Видалити fallback-інжекцію локального шляху `../../jetpack/sdks/python` у `sys.path` з `worker.py`, щоб воркер завжди імпортував `jetpack_sdk` зі встановленого пакета `jetpack-sdk` (PyPI / `.venv`).
- Узгодити версію/специфікатор `jetpack-sdk` у `app.toml` (`[python_env].requirements`) та `pyproject.toml` (`jetpack-sdk==0.1.2b2` або мінімально сумісна версія), щоб `jetpack-daemon` при розгортанні `.venv` не встановлював застарілу версію `0.1.1` замість актуальної з `pyproject.toml`.
- Оновити документацію проєкту та інструкції розробника (`README.md`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/add-binary-opcode/SKILL.md`), замінивши застарілі згадки `@jetpack/client` та ручного `jetpack-wasm` на `@jetpack-desktop/client` і `jetpack-sdk`, а також задокументувати повний цикл перезбірки та локального встановлення для перевірки з `jetpack-daemon`.

## Capabilities

### New Capabilities
<!-- Жодних нових функціональних можливостей не додається -->

### Modified Capabilities
- `jetpack-app-integration`: Оновлення вимог інтеграції — використання опублікованого npm-пакета `@jetpack-desktop/client` із вбудованим WASM без локальних `file:`-залежностей та використання опублікованого PyPI-пакета `jetpack-sdk` без локального `sys.path`-перевизначення.

## Impact

- **Frontend / Build**: `package.json`, `package-lock.json`, `src/wire.ts`, `src/main.ts`, `src/studio-controller.ts`, а також перезібрані артефакти `ui/`.
- **Python Worker / Packaging**: `worker.py`, `pyproject.toml`, `uv.lock`, `app.toml`, локальний `.venv` та ізольований `.venv` всередині `jetpack-daemon`.
- **Docs & Agent Rules**: `README.md`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/add-binary-opcode/SKILL.md`, `openspec/specs/jetpack-app-integration/spec.md`.
- **Tests**: `npm run build` (`tsc --noEmit && vite build`), `npm test`, Python unit-тести (`tests/test_pipeline.py`), `jetpack validate app.toml`, `jetpack-daemon --install-local-app .`.
