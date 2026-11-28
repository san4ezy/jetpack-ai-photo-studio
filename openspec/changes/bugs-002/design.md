# Design

## Context

Мотивацію та перелік змін наведено у [proposal.md](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/openspec/changes/bugs-002/proposal.md), а контракт поведінки — у [specs/studio-web-ui/spec.md](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/openspec/changes/bugs-002/specs/studio-web-ui/spec.md).

Поточна реалізація в [main.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/main.ts) та [styles.css](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/styles.css) обчислює рамку пошукача (`updateMinimapViewportRect`) через `canvasViewport.scrollLeft / currentRenderedWidth * currentMinimapWidth` та аналогічно виконує панорамування по кліку на мініатюру (`panFromMinimapPointer`). Такий розрахунок розходиться з фактичною видимою областю через:
1. Неузгодженість `box-sizing: border-box` (`border: 1px` + `padding: 3px`) та фіксованого зсуву `+ 6px` / `pad = 3`, через що фактичний `minimapImg` вужчий на 2px і зміщений відносно припущеної сітки.
2. Похибки примусового мінімального розміру рамки (`Math.max(10, rw)`), де `width`/`height` збільшуються до `10px`, а `left`/`top` обмежуються за старим `rw`/`rh` без центрування, через що при великому зумі рамка зміщується праворуч/униз.
3. Можливість letterbox-полів у `minimapImg` (`object-fit: contain`) при граничних пропорціях (`Math.max(36, ...)` / `Math.max(28, ...)`) та відмінності між синтетичним `currentRenderedWidth` і фактичними `DOMRect` зображення у flex-центрованому `.canvas-content`.
4. Відсутність збереження фокусної точки під час зміни масштабу (`Zoom In`, `Zoom Out`, `100%`, `Fit`, `Ctrl/Cmd + Wheel`), а також відсутність повторної синхронізації після асинхронного завантаження `minimapImg` або зміни розмірів скролбарів.

## Goals / Non-Goals

**Goals:**
- Винести чисті геометричні обчислення пошукача (нормалізація видимої області, розрахунок позиції/розміру рамки на мініатюрі, перерахунок скролу при кліку по мініатюрі, фокусне масштабування та вибір активного джерела пошукача) у тестовані чисті функції в [studio-controller.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/studio-controller.ts).
- Розраховувати видиму область та координати навігації на основі фактичних DOM-прямокутників (`canvasViewport` клієнтської області, фактичного відрендереного контенту `.viewer-frame` і фактичної області зображення всередині `minimapImg`).
- Зберігати фокусну точку при зміні масштабу (центр viewport для кнопок або позицію курсора для `Ctrl/Cmd + Wheel`) і центрувати зум при переході з непереповненого стану.
- Гарантувати синхронізацію пошукача з найостаннішим обробленим зображенням (`preview.outputUrl` та `output_width`/`output_height` при `is_processed = true`) включно з подіями `load` мініатюри, зміною розмірів `canvasViewport` та завершенням обробки.

**Non-Goals:**
- Без змін у Python-воркері ([worker.py](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/worker.py), [pipeline.py](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/pipeline.py)) або IPC-протоколі.
- Без зміни поведінки каскаду мульти-виділення Apple Time Machine або механіки перетягування слайдера «До / Після».

## Decisions

### 1. Обчислення рамки пошукача від фактичних DOM-координат замість `scrollLeft / currentRenderedWidth`
- **Рішення:** Замість формули на основі `scrollLeft / currentRenderedWidth` обчислювати нормалізоване вікно видимої частини зображення (`[x0, x1]`, `[y0, y1]` у `[0, 1]`) із фактичних координат видимої області `canvasViewport` (враховуючи `clientWidth`/`clientHeight` без скролбарів) відносно фактичного прямокутника контенту `.viewer-frame` (з урахуванням його рамки `border: 1px`). На стороні мініатюри проєкцію виконувати в межах фактично відрендереної області зображення всередині `minimapImg` (з урахуванням `padding`, `border` та `object-fit: contain` пропорцій).
- **Альтернатива:** Лише підкоригувати константи `pad` і `+ 8px` у старих формулах. Відхилено, бо це не вирішує одностороннє переповнення (центрування по одній осі), вплив скролбарів та letterbox-обмеження для витягнутих зображень.

### 2. Коректне центрування та обмеження мінімальної рамки `10px`
- **Рішення:** Коли масштабована ширина/висота рамки менша за `10px`, розширювати її до `10px` симетрично навколо центра видимої області (`center - displaySize / 2`) і обмежувати межами `[0, miniImageSize - displaySize]`, щоб рамка не зсувалася праворуч/униз і не виходила за межі зображення мініатюри.
- **Альтернатива:** Не обмежувати мінімальний розмір рамки. Відхилено, бо на 800% зумі на великому фото рамка в 1–2px стає ледь помітною.

### 3. Фокусне збереження позиції прокрутки при масштабуванні
- **Рішення:** Перед застосуванням нової шкали (`Zoom In`, `Zoom Out`, `100%`, `Ctrl/Cmd + Wheel`) фіксувати поточну фокусну точку зображення (`fx, fy` у `[0, 1]`) та її відносне положення у viewport (`anchorX, anchorY` у `[0, 1]`: `0.5, 0.5` для кнопок або координати курсора для колеса; якщо до зуму вісь не переповнювалася — `0.5, 0.5`). Після оновлення розмірів `.viewer-frame` в `updateCanvasGeometry()` встановлювати `scrollLeft`/`scrollTop` через чисту функцію `computeAnchoredZoomScroll(...)` і одразу оновлювати `updateMinimapViewportRect()`.
- **Альтернатива:** Залишити стандартну поведінку браузера при зміні `width`/`height` flex-контейнера. Відхилено, оскільки це неминуче призводить до зміщення в лівий верхній кут при збільшенні або до правого краю при зменшенні.

### 4. Гарантія роботи з найостаннішим обробленим зображенням
- **Рішення:** Виділити чисту функцію `resolveViewfinderImageState(file, preview)` у [studio-controller.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/studio-controller.ts), яка однозначно повертає `outputUrl` і `output_width ?? width` / `output_height ?? height`, щойно `file.is_processed === true && preview.outputUrl`, інакше `originalUrl` та `width` / `height`. У [main.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/main.ts) підписатися на `minimapImg.addEventListener('load', updateMinimapViewportRect)` та спостерігати за `canvasViewport` у `ResizeObserver`, щоб поява скролбарів чи асинхронне декодування нового `outputUrl` завжди перераховували рамку пошукача. Також у `runProcess()` прибрати зайвий подвійний виклик завантаження прев'ю або гарантувати, що після оновлення файлів активний `outputUrl` оновлюється атомарно.

## Risks / Trade-offs

- **Синхронне читання `getBoundingClientRect()` при події `scroll`** → Викликається лише коли `!canvasMinimap.hidden` і читає 3 елементи без циклу запис-читання, що не створює помітного layout thrashing.
- **Відмінність пропорцій «До» та «Після» у режимі `compare-box` після `Crop`/`Resize`** → Рамка `.compare-box` і `minimapImg` обидва орієнтовані на актуальні розміри найостаннішого обробленого результату (`output_width × output_height`), тому пошукач завжди точно відповідає вихідному кадру, який переглядає користувач.
