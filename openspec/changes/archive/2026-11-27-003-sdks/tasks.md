# Tasks

## 1. Frontend SDK (`@jetpack-desktop/client`) Migration

- [x] 1.1 Видалити локальну залежність `"jetpack-wasm": "file:../../jetpack/web/src/wasm/pkg"` із `package.json`, зберегти `@jetpack-desktop/client` (`^0.1.2-beta.2`) та виконати `npm install`, перевіривши, що `package-lock.json` не містить `file:../../jetpack` і папка `node_modules/@jetpack-desktop/client/wasm` присутня.
- [x] 1.2 Оновити `src/wire.ts`, `src/main.ts` і `src/studio-controller.ts`: замінити всі імпорти `@jetpack/client` на `@jetpack-desktop/client`, прибрати імпорти `jetpack-wasm` / `jetpack_wasm_bg.wasm?url` та аргументи `wasmModule` / `wasmBinaryOrUrl` у `connectStudioClient`; перевірити відсутність будь-яких згадок `@jetpack/client` і `jetpack-wasm` у `src/` та успішне виконання `npm run typecheck`.
- [x] 1.3 Перевірити генерацію типів і продакшн-збірку фронтенду: запустити `npm run codegen`, `npm run build` та `npm test`, переконавшись, що `ui/index.html` та `ui/assets/*.wasm` згенеровані без помилок і всі тести `tests/studio.test.mjs` проходять.

## 2. Python Worker SDK (`jetpack-sdk`) Migration

- [x] 2.1 Видалити блок інжекції `REPO_SDK_DIR` (`../../jetpack/sdks/python`) у `sys.path` з `worker.py`; перевірити за допомогою `.venv/bin/python -c "import jetpack_sdk; print(jetpack_sdk.__file__)"`, що імпорт іде з `.venv/.../site-packages/jetpack_sdk`, а `uv run python -m unittest discover -s tests -v` проходить повністю.
- [x] 2.2 Узгодити специфікатор `jetpack-sdk` між `pyproject.toml` (`jetpack-sdk==0.1.2b2`) і `app.toml` (`[python_env].requirements`), виконати `uv sync` та `jetpack validate app.toml`, переконавшись, що маніфест валідний без попереджень і невідомих полів.

## 3. Documentation & Local Daemon Rebuild Verification

- [x] 3.1 Оновити посилання на `@jetpack-desktop/client`, вбудований WASM та `jetpack-sdk` у `README.md`, `AGENTS.md`, `CLAUDE.md` і `.agents/skills/add-binary-opcode/SKILL.md`, а також додати до `README.md` покрокову інструкцію з оновлення залежностей, перезбірки `ui/` і перевстановлення застосунку в `jetpack-daemon`; перевірити через `grep` відсутність застарілих імпортів `@jetpack/client` у коді та інструкціях.
- [x] 3.2 Виконати повну локальну переінсталяцію застосунку через `jetpack-daemon --install-local-app .` (або `jetpack install-local .`), перевірити `jetpack-daemon --list-installed-apps` та переконатися, що встановлена версія в `~/Library/Application Support/JetPack/apps/dev.codingbro.ai-photo-studio/0.1.0` містить оновлений `ui/`, `worker.py` і `.venv` із `jetpack-sdk==0.1.2b2`.
