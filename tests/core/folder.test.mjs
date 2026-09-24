// Тесты ядра папки: каталог иконок/стилей, позиция, раскладка поповера.
// Запуск: node tests/run.mjs core

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    EDGE_MARGIN,
    FOLDER_SIZE,
    GRID,
    ICONS,
    STYLES,
    SIZE_LIMITS,
    cellSizeFor,
    clampFolderSize,
    defaultPos,
    findIcon,
    folderActive,
    isDrag,
    layoutPopover,
    moveInOrder,
    nearestSlot,
    pixelsToPos,
    pointInRect,
    posToPixels,
    posToRect,
    rectToPos,
    sortByOrder,
} from '../../src/core/folder-core.js';

console.log('folder (core)');

const PHONE = { vw: 390, vh: 844 };
const PC = { vw: 1920, vh: 911 };
const btn = (w = 42, h = w) => ({ width: w, height: h });

function inside(rect, vw, vh) {
    return rect.left >= EDGE_MARGIN - 0.5
        && rect.top >= EDGE_MARGIN - 0.5
        && rect.left + rect.width <= vw - EDGE_MARGIN + 0.5
        && rect.top + rect.height <= vh - EDGE_MARGIN + 0.5;
}

function overlaps(a, b) {
    return a.left < b.left + b.width && b.left < a.left + a.width
        && a.top < b.top + b.height && b.top < a.top + a.height;
}

// --- Каталог ---

test('у иконок и стилей уникальные id и есть подписи', () => {
    for (const list of [ICONS, STYLES]) {
        const ids = list.map((x) => x.id);
        assertEqual(new Set(ids).size, ids.length, 'id уникальны');
        assert(list.every((x) => x.label), 'подписи есть');
    }
    assert(ICONS.every((i) => i.svg || (i.closed.startsWith('fa-') && i.open.startsWith('fa-'))), 'глифы FA или свой SVG');
    assert(ICONS.some((i) => i.id === 'sparkles' && i.svg), 'три искры — своим SVG');
    assert(!ICONS.some((i) => i.id === 'wand'), 'палочки больше нет');
});

test('findIcon: неизвестный id → папка по умолчанию', () => {
    assertEqual(findIcon('paw').closed, 'fa-paw');
    assertEqual(findIcon('нет').id, 'folder');
});

// --- Позиция ---

test('по умолчанию — у правого края, по центру высоты', () => {
    const { left, top } = posToPixels(null, PHONE.vw, PHONE.vh);
    assertEqual(left, PHONE.vw - EDGE_MARGIN - FOLDER_SIZE, 'прижата вправо');
    assertEqual(top, PHONE.vh / 2 - FOLDER_SIZE / 2, 'по центру');
    const pos = defaultPos(PHONE.vw, PHONE.vh);
    assert(pos.x > 0.9 && pos.y === 0.5);
});

test('позиция за экраном прижимается внутрь', () => {
    const a = posToPixels({ x: 1, y: 1 }, PC.vw, PC.vh);
    assertEqual(a.left, PC.vw - EDGE_MARGIN - FOLDER_SIZE);
    assertEqual(a.top, PC.vh - EDGE_MARGIN - FOLDER_SIZE);
    const b = posToPixels({ x: 0, y: 0 }, PC.vw, PC.vh);
    assertEqual(b.left, EDGE_MARGIN);
    assertEqual(b.top, EDGE_MARGIN);
});

test('пиксели → доли → пиксели без сдвига', () => {
    const pos = pixelsToPos(100, 300, PHONE.vw, PHONE.vh);
    const back = posToPixels(pos, PHONE.vw, PHONE.vh);
    assert(Math.abs(back.left - 100) < 1 && Math.abs(back.top - 300) < 1, `${back.left},${back.top}`);
});

test('доли переживают поворот экрана: папка остаётся на экране', () => {
    const pos = pixelsToPos(PHONE.vw - 60, PHONE.vh - 60, PHONE.vw, PHONE.vh);
    const rotated = posToPixels(pos, PHONE.vh, PHONE.vw);
    assert(inside({ ...rotated, width: FOLDER_SIZE, height: FOLDER_SIZE }, PHONE.vh, PHONE.vw));
});

// --- Сетка ---

test('ячейка — под самую крупную кнопку, в пределах', () => {
    assertEqual(cellSizeFor([btn(36), btn(42)]), GRID.minCell, 'мелкие → минимум');
    assertEqual(cellSizeFor([btn(80)]), 80 + GRID.cellPadding);
    assertEqual(cellSizeFor([btn(300)]), GRID.maxCell, 'не больше максимума');
    assertEqual(cellSizeFor([]), GRID.minCell);
});

test('до 4 колонок, дальше — новые ряды', () => {
    const l = layoutPopover({ left: 1800, top: 400 }, Array(6).fill(btn()), PC.vw, PC.vh);
    assertEqual(l.cols, 4);
    assertEqual(l.rows, 2);
    assertEqual(l.slots.length, 6);
});

test('папка справа — поповер слева от неё и не перекрывает её', () => {
    const folder = { left: PC.vw - EDGE_MARGIN - FOLDER_SIZE, top: 400 };
    const l = layoutPopover(folder, Array(5).fill(btn()), PC.vw, PC.vh);
    assert(l.left + l.width <= folder.left, 'слева');
    assert(inside(l, PC.vw, PC.vh), 'в экране');
});

test('папка слева — поповер справа', () => {
    const folder = { left: EDGE_MARGIN, top: 400 };
    const l = layoutPopover(folder, Array(3).fill(btn()), PC.vw, PC.vh);
    assert(l.left >= folder.left + FOLDER_SIZE, 'справа');
});

test('узкий телефон: поповер в экране и не накрывает папку', () => {
    for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [1, 0.5]]) {
        const folder = { ...posToPixels({ x, y }, PHONE.vw, PHONE.vh), size: FOLDER_SIZE };
        const l = layoutPopover(folder, Array(7).fill(btn(48)), PHONE.vw, PHONE.vh);
        assert(inside(l, PHONE.vw, PHONE.vh), `в экране при ${x},${y}`);
        assert(!overlaps(l, { left: folder.left, top: folder.top, width: FOLDER_SIZE, height: FOLDER_SIZE }), `не накрывает папку при ${x},${y}`);
    }
});

test('кнопка стоит по центру своей ячейки и внутри поповера', () => {
    const l = layoutPopover({ left: 1800, top: 400 }, [btn(36), btn(48)], PC.vw, PC.vh);
    const first = l.slots[0];
    const cellLeft = l.left + GRID.padding;
    assertEqual(first.left, Math.round(cellLeft + (l.cell - 36) / 2));
    for (const [i, s] of l.slots.entries()) {
        const size = [36, 48][i];
        assert(s.left >= l.left && s.left + size <= l.left + l.width, 'по X внутри');
        assert(s.top >= l.top && s.top + size <= l.top + l.height, 'по Y внутри');
    }
});

test('очень узкий экран — одна колонка', () => {
    const l = layoutPopover({ left: 100, top: 100 }, Array(4).fill(btn()), 90, 600);
    assertEqual(l.cols, 1);
});

// --- Мелочи ---

test('isDrag: порог 6 px', () => {
    assert(!isDrag(3, 4), '5 px — тап');
    assert(isDrag(6, 6), '8.5 px — драг');
});

test('folderActive: выключено, «только мобильный» на ПК и на телефоне', () => {
    assert(!folderActive({ enabled: false, mobileOnly: false }, 390));
    assert(folderActive({ enabled: true, mobileOnly: false }, 1920), 'ПК по умолчанию работает');
    assert(!folderActive({ enabled: true, mobileOnly: true }, 1920));
    assert(folderActive({ enabled: true, mobileOnly: true }, 390));
});

// --- Размер ---

test('clampFolderSize: пределы, округление, мусор → дефолт', () => {
    assertEqual(clampFolderSize(10), SIZE_LIMITS.min);
    assertEqual(clampFolderSize(500), SIZE_LIMITS.max);
    assertEqual(clampFolderSize('52.4'), 52);
    assertEqual(clampFolderSize('abc'), FOLDER_SIZE);
});

test('папка другого размера тоже прижимается внутрь экрана', () => {
    const big = SIZE_LIMITS.max;
    const { left, top } = posToPixels({ x: 1, y: 1 }, PHONE.vw, PHONE.vh, big);
    assertEqual(left, PHONE.vw - EDGE_MARGIN - big);
    assertEqual(top, PHONE.vh - EDGE_MARGIN - big);
    const l = layoutPopover({ left, top, size: big }, Array(3).fill(btn()), PHONE.vw, PHONE.vh);
    assert(!overlaps(l, { left, top, width: big, height: big }), 'поповер не накрывает большую папку');
});

// --- Порядок ---

test('sortByOrder: известные — по order, новые — в конец по обнаружению', () => {
    const items = ['#c', '#new1', '#a', '#new2', '#b'].map((key) => ({ key }));
    const sorted = sortByOrder(items, ['#a', '#b', '#c', '#gone']).map((x) => x.key);
    assertEqual(sorted.join(' '), '#a #b #c #new1 #new2');
});

test('moveInOrder: перестановка среди видимых, невидимые сохраняются', () => {
    const order = ['#a', '#hidden', '#b', '#c'];
    const next = moveInOrder(order, ['#a', '#b', '#c'], '#c', 0);
    assertEqual(next.slice(0, 3).join(' '), '#c #a #b', 'видимые в новом порядке');
    assert(next.includes('#hidden'), 'невидимый не потерян');
});

test('moveInOrder: новый ключ (кнопку вставили с экрана)', () => {
    const next = moveInOrder(['#a', '#b'], ['#a', '#b'], '#x', 1);
    assertEqual(next.join(' '), '#a #x #b');
});

test('moveInOrder: индекс за краем — в конец', () => {
    assertEqual(moveInOrder([], ['#a', '#b'], '#a', 99).join(' '), '#b #a');
});

test('nearestSlot и pointInRect', () => {
    const slots = [
        { left: 0, top: 0, width: 40, height: 40 },
        { left: 50, top: 0, width: 40, height: 40 },
    ];
    assertEqual(nearestSlot(slots, 75, 20), 1);
    assertEqual(nearestSlot(slots, 5, 5), 0);
    assertEqual(nearestSlot([], 5, 5), -1);
    assert(pointInRect(10, 10, { left: 0, top: 0, width: 20, height: 20 }));
    assert(!pointInRect(30, 10, { left: 0, top: 0, width: 20, height: 20 }));
    assert(pointInRect(24, 10, { left: 0, top: 0, width: 20, height: 20 }, 5), 'с запасом');
});

// --- Кнопка на экране ---

test('rectToPos/posToRect: туда-обратно и прижатие к краям', () => {
    const pos = rectToPos(100, 200, 42, 42, PHONE.vw, PHONE.vh);
    const back = posToRect(pos, 42, 42, PHONE.vw, PHONE.vh);
    assert(Math.abs(back.left - 100) <= 1 && Math.abs(back.top - 200) <= 1);

    const edge = posToRect({ x: 1, y: 0 }, 48, 48, PHONE.vw, PHONE.vh);
    assertEqual(edge.left, PHONE.vw - EDGE_MARGIN - 48);
    assertEqual(edge.top, EDGE_MARGIN);
});

report('folder-core');
