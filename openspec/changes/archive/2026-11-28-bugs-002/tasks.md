# Tasks

## 1. Чиста геометрія пошукача та вибору джерела

- [x] 1.1 Додати в [studio-controller.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/studio-controller.ts) чисті функції обчислення геометрії пошукача: нормалізацію видимої області (`computeNormalizedVisibleWindow`), проєкцію рамки на мініатюру з коректним центруванням при мінімальному розмірі `10px` та урахуванням letterbox (`computeMinimapViewportRect`), розрахунок `scrollLeft`/`scrollTop` по позиції кліку на мініатюрі (`computeMinimapPanScroll`), а також розрахунок фокусного скролу при зміні масштабу (`computeAnchoredZoomScroll`); перевірити через `npm run typecheck`.
- [x] 1.2 Додати в [studio-controller.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/studio-controller.ts) чисту функцію `resolveViewfinderImageState(file, preview)` для детермінованого вибору найостаннішого обробленого зображення (`outputUrl`, `output_width`, `output_height`) при `is_processed = true` та оригіналу в інших випадках, а також усунути зайвий проміжний рефреш прев'ю в `runProcess()` без втрати оновлення; перевірити через `npm run typecheck`.

## 2. Інтеграція полотна, масштабування та пошукача у UI

- [x] 2.1 Оновити [main.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/main.ts) та [styles.css](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/styles.css): вирівняти зовнішні/внутрішні розміри `.canvas-minimap` з урахуванням `border` і `padding`, обчислювати `updateMinimapViewportRect()` і `panFromMinimapPointer()` від фактичних `DOMRect` видимої області `canvasViewport`, контенту `.viewer-frame` та фактично відрендереного зображення в `minimapImg`; перевірити через `npm run build`.
- [x] 2.2 Реалізувати у [main.ts](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/src/main.ts) збереження фокусної точки при зміні масштабу (`Zoom In`, `Zoom Out`, `100%`, `Fit`, `Ctrl/Cmd + Wheel`), ре-синхронізацію `updateMinimapViewportRect()` на подіях `minimapImg` `load`, `canvasViewport` `scroll` та `ResizeObserver` для `canvasViewport`, і гарантовану підстановку найостаннішого обробленого зображення у пошукач; перевірити через `npm run build`.

## 3. Модульні тести та верифікація

- [x] 3.1 Додати в [studio.test.mjs](file:///Users/alexander/development/projects/jetpack-apps/ai-photo-studio/tests/studio.test.mjs) тести для `computeNormalizedVisibleWindow`, `computeMinimapViewportRect` (включно з центром зображення, краями, мінімальним розміром `10px`, одностороннім переповненням та нестандартними пропорціями), `computeMinimapPanScroll`, `computeAnchoredZoomScroll` і `resolveViewfinderImageState` (до обробки, після першої та повторної обробки, після відновлення); перевірити, що `npm test` проходить повністю.
- [x] 3.2 Виконати фінальну перевірку збірки (`npm run typecheck && npm run build && npm test`) і переконатися в чистоті OpenSpec-зміни (`openspec validate bugs-002`).
