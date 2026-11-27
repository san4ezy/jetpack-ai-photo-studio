# Design

## Context

Див. [proposal.md](./proposal.md) щодо мотивації. На момент планування в робочому дереві вже частково оновлено маніфести залежностей (`package.json` містить `"@jetpack-desktop/client": "^0.1.2-beta.2"`, `pyproject.toml` містить `"jetpack-sdk==0.1.2b2"` та згенерований `uv.lock`), проте вихідний код і конфігурація лишаються в перехідному стані:
- `src/wire.ts`, `src/main.ts`, `src/studio-controller.ts` досі імпортують `@jetpack/client`, через що `npm run build` падає з `TS2307`.
- `package.json` і `package-lock.json` досі містять локальну залежність `"jetpack-wasm": "file:../../jetpack/web/src/wasm/pkg"`, а `src/wire.ts` передає `wasmModule` та `wasmBinaryOrUrl` у `connectAndEnsureApp`.
- `worker.py` (рядки 16–19) все ще вставляє `../../jetpack/sdks/python` у `sys.path`, перекриваючи пакет із PyPI при локальній розробці.
- `app.toml` містить непінований рядок `"jetpack-sdk"` у `[python_env].requirements`, тоді як на PyPI стабільний реліз `0.1.1` і пререліз `0.1.2b2`: без явного специфікатора `jetpack-daemon` встановлює у своє ізольоване `.venv` версію `0.1.1`, тоді як локальний `pyproject.toml` закріплений на `0.1.2b2`.

## Goals / Non-Goals

**Goals:**
- Повністю усунути залежності та посилання на локальний монорепозиторій `../../jetpack` як у Node/Vite-збірці, так і в Python-воркері.
- Переконатися, що `@jetpack-desktop/client` автоматично ініціалізує вбудований WASM (`@jetpack-desktop/client/wasm`) як у Vite dev server, так і у зібраному `ui/` під `jetpack-daemon`.
- Гарантувати узгодженість версії `jetpack-sdk` між локальним `.venv` (`pyproject.toml`) та ізольованим `.venv` воркера під керуванням `jetpack-daemon` (`app.toml`).
- Забезпечити чисте проходження `npm run codegen`, `npm run build`, `npm test`, Python unit-тестів, `jetpack validate app.toml` та локального встановлення в `jetpack-daemon`.

**Non-Goals:**
- Публікація нових версій самих SDK на PyPI або npm.
- Зміна функціональності обробки зображень (`pipeline.py`), протоколу опкодів або UI-компонентів (`studio-controller.ts`, крім типу клієнта).
- Налаштування нового OCI-реєстру чи CI/CD для дистрибуції.

## Decisions

1. **Використовувати вбудований WASM у `@jetpack-desktop/client` замість окремого пакета `jetpack-wasm`**
   - *Вибір*: Прибрати `jetpack-wasm` із `package.json` (та оновити `package-lock.json` через `npm install`), а в `src/wire.ts` видалити імпорти `jetpack-wasm`, `jetpack-wasm/jetpack_wasm_bg.wasm?url` і параметри `wasmModule` / `wasmBinaryOrUrl` у `connectAndEnsureApp`.
   - *Обґрунтування*: Пакет `@jetpack-desktop/client@0.1.2-beta.2` постачається з уже скомпільованими `wasm/jetpack_wasm.js` і `wasm/jetpack_wasm_bg.wasm`, експортує `./wasm` та автоматично резолвить `.wasm` і в Vite dev (`/.vite/deps/` fallback у `client.js`), і в Vite production build (`import('../wasm/jetpack_wasm.js')`).
   - *Альтернатива*: Імпортувати `@jetpack-desktop/client/wasm` вручну в `src/wire.ts`. Відхилено як зайвий бойлерплейт; залишено як резервний варіант, лише якщо перевірка `vite build` / runtime виявить проблему з бандлінгом `.wasm` у Vite 8.

2. **Видалити `REPO_SDK_DIR` `sys.path` інжекцію з `worker.py`**
   - *Вибір*: Видалити блок із `SCRIPT_DIR` / `REPO_SDK_DIR` (`../../jetpack/sdks/python`) у `worker.py`.
   - *Обґрунтування*: Якщо цей каталог присутній на машині розробника, він перехоплює імпорт `jetpack_sdk` замість пакета, встановленого з PyPI в `.venv`, що маскує проблеми версій та інсталяції.
   - *Альтернатива*: Перемістити `REPO_SDK_DIR` у кінець `sys.path` (`append` замість `insert(0, ...)`). Відхилено, щоб у коді проєкту взагалі не було прихованої зв'язаності з зовнішнім деревом каталогів.

3. **Узгодити специфікатор `jetpack-sdk` у `app.toml` з `pyproject.toml`**
   - *Вибір*: Замінити `"jetpack-sdk"` на `"jetpack-sdk==0.1.2b2"` у `[python_env].requirements` в `app.toml` (або вказати точну потрібну версію з PyPI, синхронну з `pyproject.toml`).
   - *Обґрунтування*: `0.1.2b2` є пререлізом на PyPI, тоді як `0.1.1` — останній стабільний реліз. Без явного `==0.1.2b2` у `app.toml` `uv` всередині `jetpack-daemon` ігнорує бета-версію та ставить `0.1.1`. Явне закріплення гарантує однаковий runtime у `.venv` розробника та в пісочниці `jetpack-daemon`.
   - *Примітка*: Під час застосування потрібно перевірити, що `jetpack validate app.toml` та `jetpack-daemon --install-local-app .` приймають специфікатор `"jetpack-sdk==0.1.2b2"` (якщо `jetpack-daemon` або офлайн-режим вимагатимуть інакшого, це буде виявлено на етапі валідації).

4. **Оновити документацію, правила агентів і цикл перезбірки для `jetpack-daemon`**
   - *Вибір*: Оновити `@jetpack/client` -> `@jetpack-desktop/client` і прибрати згадки про ручний `jetpack-wasm` у `README.md`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/add-binary-opcode/SKILL.md`. Також у `README.md` описати відтворюваний цикл локального оновлення (`uv sync`, `npm install`, `npm run codegen`, `npm run build`, `jetpack validate app.toml`, `jetpack-daemon --install-local-app .` і перезапуск воркера).

## Risks / Trade-offs

- **Pre-release `jetpack-sdk==0.1.2b2` у `app.toml`** → Якщо `jetpack-daemon` має власний офлайн-колесо `jetpack-sdk` іншої версії або суворий парсер назв у `requirements`, це одразу перевіряється через `jetpack validate app.toml` і тестовий запуск у `jetpack-daemon`.
- **Vite 8 pre-bundling / production asset resolution для внутрішнього `import('../wasm/jetpack_wasm.js')` у `@jetpack-desktop/client`** → Під час імплементації обов'язково перевірити `npm run build`, вміст `ui/assets/*.wasm` та, за можливості, фактичне завантаження UI через `jetpack-daemon`; у разі потреби можна явно передати `wasmModule` із `@jetpack-desktop/client/wasm` у `src/wire.ts`.
- **Кешований `.venv` у встановленому додатку `jetpack-daemon`** → Якщо додаток `dev.codingbro.ai-photo-studio` (`0.1.0`) уже встановлений у `~/Library/Application Support/JetPack/apps/...`, стара `.venv` може утримувати `jetpack-sdk 0.1.1`; потрібно зупинити активний воркер і переінсталювати/пересинхронізувати застосунок.
