// Чистая логика папки — без DOM: каталог иконок и стилей, позиция папки на экране,
// раскладка сетки поповера. Тестируется под node (tests/core/folder.test.mjs).

// --- Внешний вид ---
//
// Иконки — Font Awesome 6, он уже подключён в SillyTavern. У каждой — закрытое и
// открытое состояние (у папки это разные глифы, у остальных open просто совпадает).
// Иконка с полем `svg` рисуется своим SVG (src/ui/icons.js) — для форм, которых нет среди
// бесплатных глифов FA.
export const ICONS = Object.freeze([
    { id: 'folder', label: 'Папка', closed: 'fa-folder', open: 'fa-folder-open' },
    { id: 'grid', label: 'Сетка', closed: 'fa-table-cells-large', open: 'fa-table-cells-large' },
    { id: 'layers', label: 'Слои', closed: 'fa-layer-group', open: 'fa-layer-group' },
    { id: 'box', label: 'Коробка', closed: 'fa-box', open: 'fa-box-open' },
    { id: 'puzzle', label: 'Пазл', closed: 'fa-puzzle-piece', open: 'fa-puzzle-piece' },
    { id: 'dots', label: 'Точки', closed: 'fa-ellipsis', open: 'fa-xmark' },
    { id: 'star', label: 'Звезда', closed: 'fa-star', open: 'fa-star' },
    { id: 'heart', label: 'Сердце', closed: 'fa-heart', open: 'fa-heart' },
    { id: 'paw', label: 'Лапка', closed: 'fa-paw', open: 'fa-paw' },
    { id: 'sparkles', label: 'Искры', svg: 'sparkles' },
]);

// Стили кнопки папки. Все берут цвета из темы ST через слой --stf-* (style.css), так что
// при смене темы папка перекрашивается сама.
//   theme   — как панели ST: тонированный фон темы с размытием и рамкой
//   accent  — залита акцентным цветом темы
//   glass   — почти прозрачная, только размытие и тонкая рамка
//   minimal — одна иконка с тенью, без подложки
export const STYLES = Object.freeze([
    { id: 'theme', label: 'Как тема' },
    { id: 'accent', label: 'Акцент' },
    { id: 'glass', label: 'Стекло' },
    { id: 'minimal', label: 'Только иконка' },
]);

export const DEFAULT_ICON = 'folder';
export const DEFAULT_STYLE = 'theme';

export function findIcon(id) {
    return ICONS.find((icon) => icon.id === id) ?? ICONS.find((icon) => icon.id === DEFAULT_ICON);
}

export const ICON_IDS = Object.freeze(ICONS.map((icon) => icon.id));

// Иконки, которые убрали из каталога, → чем их заменить у тех, кто их выбрал.
export const RENAMED_ICONS = Object.freeze({ wand: 'sparkles' });
export const STYLE_IDS = Object.freeze(STYLES.map((style) => style.id));

// --- Геометрия ---

export const FOLDER_SIZE = 44; // под палец
export const EDGE_MARGIN = 8; // отступ от краёв экрана
export const GRID = Object.freeze({
    maxCols: 4,
    minCell: 56,
    maxCell: 104,
    cellPadding: 8, // кнопка в ячейке — с запасом по краям
    gap: 6,
    padding: 8, // поля поповера
    offset: 10, // зазор между папкой и поповером
});

function clamp(value, min, max) {
    if (max < min) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
}

// Позиция папки хранится долями вьюпорта (0..1) для её центра — так она переживает
// поворот экрана и смену размера окна. null — не переставлялась: справа по центру.
export function defaultPos(vw, vh, size = FOLDER_SIZE) {
    return { x: (vw - EDGE_MARGIN - size / 2) / vw, y: 0.5 };
}

// Переводит долю в пиксели левого верхнего угла, прижимая папку внутрь экрана.
export function posToPixels(pos, vw, vh, size = FOLDER_SIZE) {
    const p = pos ?? defaultPos(vw, vh, size);
    const half = size / 2;
    const cx = clamp(p.x * vw, EDGE_MARGIN + half, vw - EDGE_MARGIN - half);
    const cy = clamp(p.y * vh, EDGE_MARGIN + half, vh - EDGE_MARGIN - half);
    return { left: cx - half, top: cy - half };
}

// Обратно: левый верхний угол в пикселях → доли центра, тоже с прижатием.
export function pixelsToPos(left, top, vw, vh, size = FOLDER_SIZE) {
    const { left: l, top: t } = posToPixels(
        { x: (left + size / 2) / vw, y: (top + size / 2) / vh },
        vw,
        vh,
        size,
    );
    return { x: round4((l + size / 2) / vw), y: round4((t + size / 2) / vh) };
}

function round4(value) {
    return Math.round(value * 10_000) / 10_000;
}

// Размер ячейки — под самую крупную кнопку, в пределах [minCell, maxCell].
export function cellSizeFor(sizes) {
    const largest = sizes.reduce((max, s) => Math.max(max, s.width || 0, s.height || 0), 0);
    return clamp(Math.ceil(largest + GRID.cellPadding), GRID.minCell, GRID.maxCell);
}

// Раскладка поповера рядом с папкой, в сторону центра экрана.
//   folder — { left, top, size } папки в пикселях
//   sizes  — [{ width, height }] кнопок в порядке показа
// Возвращает { left, top, width, height, cols, rows, cell, slots: [{ left, top }] },
// где slots — левый верхний угол каждой кнопки (по центру своей ячейки), в пикселях
// вьюпорта.
export function layoutPopover(folder, sizes, vw, vh) {
    const count = Math.max(sizes.length, 1);
    const cell = cellSizeFor(sizes);

    // Сколько колонок влезает по ширине экрана.
    const fitCols = Math.max(1, Math.floor((vw - 2 * EDGE_MARGIN - 2 * GRID.padding + GRID.gap) / (cell + GRID.gap)));
    const cols = Math.min(GRID.maxCols, count, fitCols);
    const rows = Math.ceil(count / cols);

    const width = cols * cell + (cols - 1) * GRID.gap + 2 * GRID.padding;
    const height = rows * cell + (rows - 1) * GRID.gap + 2 * GRID.padding;

    const size = folder.size ?? FOLDER_SIZE;
    const fx = folder.left + size / 2;
    const fy = folder.top + size / 2;

    // По горизонтали — в ту сторону, где больше места; если сбоку не влезает, то
    // над/под папкой.
    const spaceRight = vw - (folder.left + size) - GRID.offset - EDGE_MARGIN;
    const spaceLeft = folder.left - GRID.offset - EDGE_MARGIN;
    let left;
    let top;
    if (Math.max(spaceLeft, spaceRight) >= width) {
        left = fx < vw / 2 ? folder.left + size + GRID.offset : folder.left - GRID.offset - width;
        top = fy - height / 2;
    } else {
        left = fx - width / 2;
        top = fy < vh / 2 ? folder.top + size + GRID.offset : folder.top - GRID.offset - height;
    }
    left = clamp(left, EDGE_MARGIN, vw - EDGE_MARGIN - width);
    top = clamp(top, EDGE_MARGIN, vh - EDGE_MARGIN - height);

    const slots = sizes.map((s, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cellLeft = left + GRID.padding + col * (cell + GRID.gap);
        const cellTop = top + GRID.padding + row * (cell + GRID.gap);
        return {
            left: Math.round(cellLeft + (cell - (s.width || 0)) / 2),
            top: Math.round(cellTop + (cell - (s.height || 0)) / 2),
        };
    });

    return { left: Math.round(left), top: Math.round(top), width, height, cols, rows, cell, slots };
}

// Порог, после которого нажатие на папку считается перетаскиванием, а не тапом.
export const DRAG_THRESHOLD = 6;

export function isDrag(dx, dy, threshold = DRAG_THRESHOLD) {
    return Math.hypot(dx, dy) > threshold;
}

// Работает ли папка при данной ширине экрана.
export const MOBILE_BREAKPOINT = 1000;

export function folderActive(settings, vw) {
    if (!settings?.enabled) return false;
    if (settings.mobileOnly && vw > MOBILE_BREAKPOINT) return false;
    return true;
}

// --- Размер папки ---

export const SIZE_LIMITS = Object.freeze({ min: 32, max: 72, step: 4 });

export function clampFolderSize(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return FOLDER_SIZE;
    return clamp(Math.round(n), SIZE_LIMITS.min, SIZE_LIMITS.max);
}

// --- Порядок кнопок в папке ---
//
// settings.order — ключи в порядке показа. Кнопки, которых в нём нет (новые), идут
// в конец в порядке обнаружения. Ключи ушедших кнопок из order не выкидываем: кнопка
// может вернуться (контекстная, скрытая настройкой) и должна встать на своё место.

export function sortByOrder(items, order, keyOf = (item) => item.key) {
    const rank = new Map(order.map((key, i) => [key, i]));
    return items
        .map((item, i) => ({ item, i, r: rank.has(keyOf(item)) ? rank.get(keyOf(item)) : Infinity }))
        .sort((a, b) => (a.r - b.r) || (a.i - b.i))
        .map((x) => x.item);
}

// Ставит key на позицию index среди видимых сейчас ключей `visible` и возвращает новый
// order. Позиции невидимых ключей относительно друг друга сохраняются.
export function moveInOrder(order, visible, key, index) {
    const shown = visible.filter((k) => k !== key);
    const at = clamp(index, 0, shown.length);
    shown.splice(at, 0, key);

    const hidden = order.filter((k) => !shown.includes(k));
    // Видимые — в новом порядке, за ними — те, кого сейчас нет.
    return [...shown, ...hidden];
}

// Индекс ближайшей ячейки к точке (x, y). slots — [{ left, top, width, height }].
export function nearestSlot(slots, x, y) {
    let best = -1;
    let bestDist = Infinity;
    slots.forEach((s, i) => {
        const cx = s.left + (s.width ?? 0) / 2;
        const cy = s.top + (s.height ?? 0) / 2;
        const d = Math.hypot(cx - x, cy - y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return best;
}

export function pointInRect(x, y, r, pad = 0) {
    return x >= r.left - pad && x <= r.left + r.width + pad && y >= r.top - pad && y <= r.top + r.height + pad;
}

// --- Кнопка, вытащенная на экран ---
//
// Позиция хранится как доли вьюпорта для центра кнопки (как у папки) и прижимается
// внутрь экрана с учётом её размера.

export function rectToPos(left, top, width, height, vw, vh) {
    const { left: l, top: t } = posToRect({ x: (left + width / 2) / vw, y: (top + height / 2) / vh }, width, height, vw, vh);
    return { x: round4((l + width / 2) / vw), y: round4((t + height / 2) / vh) };
}

export function posToRect(pos, width, height, vw, vh) {
    const cx = clamp(pos.x * vw, EDGE_MARGIN + width / 2, vw - EDGE_MARGIN - width / 2);
    const cy = clamp(pos.y * vh, EDGE_MARGIN + height / 2, vh - EDGE_MARGIN - height / 2);
    return { left: Math.round(cx - width / 2), top: Math.round(cy - height / 2) };
}

// Долгое нажатие на папку — вход в режим «Упорядочить».
export const LONG_PRESS_MS = 550;
