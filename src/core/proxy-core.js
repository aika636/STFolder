// Чистая логика прокси-режима — без DOM. Прокси нужен кнопкам, которые живое
// размещение не берёт: у них инлайновый style="… !important" сильнее даже нашего
// @layer, и кнопка не встаёт в ячейку. Тогда в ячейке рисуется копия, а нажатие на неё
// пересылается оригиналу цепочкой событий.

// Как показывать кнопку в папке (settings.buttons[key].view):
//   auto  — живьём, а если не встала в ячейку — копией (по умолчанию, поля нет);
//   live  — всегда живьём, даже если криво;
//   proxy — всегда копией.
export const VIEW_MODES = Object.freeze(['auto', 'live', 'proxy']);
export const DEFAULT_VIEW = 'auto';

export function viewOf(entry) {
    return VIEW_MODES.includes(entry?.view) ? entry.view : DEFAULT_VIEW;
}

// Показывать ли кнопку копией. autoProxied — ключи, у которых живое размещение
// провалилось в этой сессии.
export function useProxy(entry, key, autoProxied) {
    const view = viewOf(entry);
    if (view === 'proxy') return true;
    if (view === 'live') return false;
    return autoProxied.has(key);
}

// Встала ли кнопка туда, куда её ставили. Допуск — пара пикселей на субпиксельное
// округление; нулевой размер — кнопку так и не показали (display: none !important
// инлайном).
export const PLACEMENT_TOLERANCE = 3;

export function placementFailed(expected, rect, tolerance = PLACEMENT_TOLERANCE) {
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return true;
    return Math.abs(rect.left - expected.left) > tolerance || Math.abs(rect.top - expected.top) > tolerance;
}

// Какие события слать оригиналу по тапу на копию. Pointer-события и click — всегда.
// Мышиные или тач-события — одни из двух: расширения часто вешают один обработчик на
// «mousedown touchstart», и оба сразу открыли бы и тут же закрыли панель. Тач — только
// если у кнопки видны тач-обработчики и не видно мышиных (узнаём через jQuery._data;
// addEventListener снаружи не виден, поэтому по умолчанию — мышь: её слушают почти все).
export function tapSequence({ hasMouse = false, hasTouch = false, touchSupported = true } = {}) {
    const touch = hasTouch && !hasMouse && touchSupported;
    return touch
        ? ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'click']
        : ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
}

// Какие вычисленные стили переносить на копию, чтобы она выглядела как оригинал. Копия
// теряет id (дубли id сломали бы расширение), а с ним — стили по #id; поэтому
// переносим «внешность» инлайном. Геометрию позиционирования (position, inset,
// transform, margin) не берём: копия стоит в ячейке.
export const COPY_STYLE_PROPS = Object.freeze([
    'display', 'box-sizing', 'width', 'height', 'min-width', 'min-height',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'gap',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'color', 'opacity', 'box-shadow', 'filter', 'backdrop-filter',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-shadow', 'white-space', 'overflow',
    'visibility',
]);

// Для потомков (иконка, бейдж) геометрию внутри кнопки переносим — бейдж обычно
// absolute в углу.
export const COPY_CHILD_EXTRA_PROPS = Object.freeze([
    'position', 'top', 'right', 'bottom', 'left', 'transform', 'z-index',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
]);
