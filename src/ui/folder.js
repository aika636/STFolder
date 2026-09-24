// Папка: круглая кнопка поверх таверны, бейдж с числом спрятанных кнопок и поповер-сетка,
// в ячейки которой dock.js ставит настоящие чужие кнопки. Работает одинаково пальцем и
// мышью (pointer-события), на ПК ещё с клавиатуры: Enter/Пробел — открыть, Esc — закрыть.
//
// Режим «Упорядочить» (долгое нажатие на папку или плитка ✥ в сетке): кнопки можно
// переставлять внутри папки, вытаскивать на экран и возвращать обратно. Пока режим
// включён, события нажатия на чужих кнопках перехватываются на window в фазе захвата —
// расширение не принимает перетаскивание за свой тап или свой драг.

import {
    LONG_PRESS_MS,
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
    STYLE_IDS,
} from '../core/folder-core.js';
import { placementFailed, useProxy } from '../core/proxy-core.js';
import { logError, warnOnce } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { OWN_ATTR, getLastScan, onScan, rescanNow, withoutObserving } from './detector.js';
import { renderIcon } from './icons.js';
import { drop, hideAgain, isManaged, lift, placeAll, releaseAll, setArrangeable, stowAll, syncDock } from './dock.js';
import { activateProxies, deactivateProxies, ensureProxy, keepProxies, proxyCell } from './proxy.js';

// Если тап по кнопке в папке не дал click (расширение глушит его в touchend), папка
// всё равно закроется через это время после отпускания.
const CLOSE_AFTER_POINTERUP_MS = 400;
// Плитка режима «Упорядочить» в сетке.
const TOOL_SIZE = 36;
// Запас вокруг папки и поповера, в который ещё можно «попасть» кнопкой при вставке.
const DROP_PAD = 14;

let folderEl = null;
let iconEl = null;
let badgeEl = null;
let popoverEl = null;
let toolEl = null;
let isOpen = false;
let arranging = false;
// Кнопки в папке (по порядку) и кнопки на экране: [{ el, key, desc, proxy? }].
let docked = [];
// Ключи кнопок, у которых живое размещение провалилось в этой сессии, — показываются
// копией, пока в настройках не выбрано «Живая».
const autoProxied = new Set();
let onScreen = [];
// Ячейки последней раскладки: [{ key, left, top, width, height }].
let lastSlots = [];
let closeTimer = null;
// Перетаскивание чужой кнопки в режиме «Упорядочить».
let btnDrag = null;

function own(el) {
    el.setAttribute(OWN_ATTR, '');
    return el;
}

function folderSize() {
    return getSettings().size;
}

function createElements() {
    folderEl = own(document.createElement('div'));
    folderEl.className = 'stf-folder';
    folderEl.setAttribute('role', 'button');
    folderEl.setAttribute('tabindex', '0');
    folderEl.setAttribute('aria-haspopup', 'true');
    folderEl.setAttribute('aria-expanded', 'false');

    // Контейнер иконки: внутри глиф FA или свой SVG (src/ui/icons.js).
    iconEl = document.createElement('span');
    iconEl.className = 'stf-folder-icon';

    badgeEl = document.createElement('span');
    badgeEl.className = 'stf-badge';

    folderEl.append(iconEl, badgeEl);

    popoverEl = own(document.createElement('div'));
    popoverEl.className = 'stf-popover';
    popoverEl.hidden = true;

    toolEl = own(document.createElement('div'));
    toolEl.className = 'stf-tool';
    toolEl.setAttribute('role', 'button');
    toolEl.setAttribute('tabindex', '0');
    toolEl.innerHTML = '<i class="fa-solid" aria-hidden="true"></i>';
    toolEl.addEventListener('click', () => setArranging(!arranging));
    toolEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setArranging(!arranging);
        }
    });
    popoverEl.appendChild(toolEl);

    withoutObserving(() => document.body.append(popoverEl, folderEl));
}

// --- Вид ---

function applyAppearance() {
    const settings = getSettings();
    const icon = findIcon(settings.icon);
    const size = folderSize();
    const iconKey = `${icon.id}:${isOpen}`;
    if (iconEl.dataset.icon !== iconKey) {
        iconEl.replaceChildren(renderIcon(icon, isOpen));
        iconEl.dataset.icon = iconKey;
    }
    for (const id of STYLE_IDS) folderEl.classList.toggle(`stf-style-${id}`, id === settings.style);
    folderEl.classList.toggle('stf-open', isOpen);
    folderEl.classList.toggle('stf-arranging', arranging);
    folderEl.setAttribute('aria-expanded', String(isOpen));
    folderEl.style.width = `${size}px`;
    folderEl.style.height = `${size}px`;
    folderEl.style.fontSize = `${Math.round(size * (settings.style === 'minimal' ? 0.55 : 0.43))}px`;

    popoverEl.classList.toggle('stf-arranging', arranging);
    toolEl.firstElementChild.className = `fa-solid ${arranging ? 'fa-check' : 'fa-up-down-left-right'}`;
    toolEl.title = arranging
        ? 'Готово'
        : 'Упорядочить: переставить, вытащить на экран, вернуть в папку';
    toolEl.setAttribute('aria-label', toolEl.title);
    toolEl.setAttribute('aria-pressed', String(arranging));
}

function applyPosition() {
    const { left, top } = posToPixels(getSettings().pos, window.innerWidth, window.innerHeight, folderSize());
    folderEl.style.left = `${left}px`;
    folderEl.style.top = `${top}px`;
}

function updateBadge() {
    const n = docked.length;
    badgeEl.textContent = n > 9 ? '9+' : String(n);
    badgeEl.hidden = n === 0;
    folderEl.title = arranging
        ? 'Упорядочить кнопки — тап, чтобы закончить'
        : `Папка кнопок: ${n}. Долгое нажатие — упорядочить`;
    folderEl.setAttribute('aria-label', folderEl.title);
}

// --- Синхронизация с детектором и настройками ---

function entryOf(key) {
    return getSettings().buttons[key];
}

function sync(scan = getLastScan()) {
    if (!folderEl) return;
    // Пока кнопку тащат, раскладку не трогаем — она под пальцем. Досинхронизируем на
    // отпускании.
    if (btnDrag) return;

    const settings = getSettings();
    const active = folderActive(settings, window.innerWidth);
    const found = active ? scan.found : [];

    docked = sortByOrder(found.filter((b) => (entryOf(b.key)?.mode ?? 'folder') === 'folder'), settings.order)
        .map((b) => ({ ...b, proxy: useProxy(entryOf(b.key), b.key, autoProxied) }));
    onScreen = found.filter((b) => entryOf(b.key)?.mode === 'screen');

    // Папку показываем, пока есть хоть одна найденная кнопка: даже если все вытащены на
    // экран, в папку должно быть куда их вернуть.
    if (found.length === 0) {
        if (arranging) setArranging(false);
        if (isOpen) close();
        releaseAll();
        withoutObserving(() => { folderEl.hidden = true; });
        return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placed = onScreen
        .filter((b) => entryOf(b.key)?.pos)
        .map((b) => ({ el: b.el, key: b.key, ...posToRect(entryOf(b.key).pos, b.desc.width, b.desc.height, vw, vh) }));

    syncDock(docked, placed);
    withoutObserving(() => {
        folderEl.hidden = false;
        applyAppearance();
        applyPosition();
        updateBadge();
    });
    if (isOpen) layout();
    if (arranging) setArrangeable(arrangeableEls());
}

// Что можно таскать в режиме «Упорядочить»: живые кнопки, ячейки-копии, кнопки на экране.
function arrangeableEls() {
    return [
        ...docked.map((b) => (b.proxy ? proxyCell(b.key) : b.el)).filter(Boolean),
        ...onScreen.map((b) => b.el),
    ];
}

// Настройки поменялись в панели (иконка, стиль, размер, режимы кнопок, вкл/выкл).
export function refreshFolder() {
    try {
        sync();
    } catch (err) {
        logError('refreshFolder упал', err);
    }
}

// Для панели: показывается ли кнопка копией потому, что живьём не встала.
export function isAutoProxied(key) {
    return autoProxied.has(key);
}

// --- Управление снаружи (wand-меню, /stfolder, ручной выбор) ---

// Почему папки сейчас нет на экране, или null, если она есть.
export function folderUnavailableReason() {
    const settings = getSettings();
    if (!settings.enabled) return 'STFolder выключен в настройках';
    if (!folderActive(settings, window.innerWidth)) return 'включено «Только на мобильном», а экран широкий';
    if (!folderEl || folderEl.hidden) return 'плавающих кнопок не найдено';
    return null;
}

export function openFolder() {
    if (folderUnavailableReason()) return false;
    open();
    return true;
}

export function closeFolder() {
    close();
}

export function toggleFolder() {
    if (isOpen) {
        close();
        return true;
    }
    return openFolder();
}

export function arrangeFolder() {
    if (folderUnavailableReason()) return false;
    setArranging(true);
    return true;
}

export function resetFolderPosition() {
    getSettings().pos = null;
    saveSettings();
    refreshFolder();
}

// --- Открытие ---

function layout(retry = true) {
    const rect = folderEl.getBoundingClientRect();
    const sizes = [
        ...docked.map((b) => ({ width: b.desc.width, height: b.desc.height })),
        { width: TOOL_SIZE, height: TOOL_SIZE },
    ];
    const l = layoutPopover(
        { left: rect.left, top: rect.top, size: folderSize() },
        sizes,
        window.innerWidth,
        window.innerHeight,
    );

    const toolSlot = l.slots[l.slots.length - 1];
    withoutObserving(() => {
        Object.assign(popoverEl.style, {
            left: `${l.left}px`,
            top: `${l.top}px`,
            width: `${l.width}px`,
            height: `${l.height}px`,
        });
        toolEl.style.left = `${toolSlot.left - l.left}px`;
        toolEl.style.top = `${toolSlot.top - l.top}px`;
        popoverEl.hidden = false;
    });

    lastSlots = docked.map((b, i) => ({ key: b.key, ...l.slots[i], width: b.desc.width, height: b.desc.height }));

    // Копии — своими ячейками внутри поповера.
    const proxyKeys = new Set();
    docked.forEach((b, i) => {
        if (!b.proxy) return;
        proxyKeys.add(b.key);
        const cell = ensureProxy(b, popoverEl, onProxyTap);
        if (cell.classList.contains('stf-lifted')) return;
        withoutObserving(() => Object.assign(cell.style, {
            left: `${l.slots[i].left - l.left}px`,
            top: `${l.slots[i].top - l.top}px`,
            width: `${Math.round(b.desc.width)}px`,
            height: `${Math.round(b.desc.height)}px`,
        }));
    });
    keepProxies(proxyKeys);

    // Живые — настоящие кнопки в ячейках. Проверяем, что встали: инлайновый
    // style="left: … !important" наш @layer не перебивает — такую кнопку показываем
    // копией.
    const live = docked.map((b, i) => ({ b, slot: l.slots[i] })).filter((x) => !x.b.proxy);
    placeAll(live.map(({ b, slot }) => ({ el: b.el, ...slot })));

    let failed = false;
    for (const { b, slot } of live) {
        if (viewOfEntry(b.key) === 'live') continue;
        if (placementFailed(slot, b.el.getBoundingClientRect())) {
            warnOnce(`proxy:${b.key}`, `${b.key} не встаёт в ячейку живьём — показываю копией`);
            autoProxied.add(b.key);
            b.proxy = true;
            hideAgain(b.el);
            failed = true;
        }
    }
    if (failed) {
        if (retry) layout(false);
        activateProxies();
    }
}

function viewOfEntry(key) {
    return entryOf(key)?.view ?? 'auto';
}

function onProxyTap() {
    if (arranging) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 0);
}

function open() {
    if (isOpen) return;
    isOpen = true;
    withoutObserving(applyAppearance);
    layout();
    activateProxies();
}

function close() {
    clearTimeout(closeTimer);
    if (arranging) setArranging(false);
    if (!isOpen) return;
    isOpen = false;
    deactivateProxies();
    stowAll();
    withoutObserving(() => {
        popoverEl.hidden = true;
        applyAppearance();
    });
}

function toggle() {
    if (isOpen) close();
    else open();
}

// --- Режим «Упорядочить» ---

function setArranging(on) {
    if (arranging === on) return;
    arranging = on;
    if (on && !isOpen) open();
    setArrangeable(on ? arrangeableEls() : []);
    withoutObserving(() => {
        applyAppearance();
        updateBadge();
    });
}

function arrangeableAt(node) {
    if (!arranging || !(node instanceof Element)) return null;
    return node.closest('.stf-arrangeable');
}

function findButton(el) {
    if (el.classList.contains('stf-proxy')) return docked.find((b) => b.key === el.dataset.key) ?? null;
    return docked.find((b) => b.el === el) ?? onScreen.find((b) => b.el === el) ?? null;
}

function startButtonDrag(e, el) {
    const button = findButton(el);
    if (!button) return;
    const rect = el.getBoundingClientRect();
    btnDrag = {
        el,
        key: button.key,
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offX: e.clientX - rect.left,
        offY: e.clientY - rect.top,
        width: button.desc.width,
        height: button.desc.height,
        moved: false,
    };
}

function moveButtonDrag(e) {
    if (!btnDrag || e.pointerId !== btnDrag.id) return;
    if (!btnDrag.moved && !isDrag(e.clientX - btnDrag.startX, e.clientY - btnDrag.startY)) return;
    btnDrag.moved = true;
    lift(btnDrag.el, e.clientX - btnDrag.offX, e.clientY - btnDrag.offY);

    // Подсказка, что отпускание вернёт кнопку в папку.
    const over = isOverFolder(e.clientX, e.clientY);
    withoutObserving(() => {
        popoverEl.classList.toggle('stf-drop-target', over);
        folderEl.classList.toggle('stf-drop-target', over);
    });
}

function isOverFolder(x, y) {
    if (pointInRect(x, y, folderEl.getBoundingClientRect(), DROP_PAD)) return true;
    return isOpen && pointInRect(x, y, popoverEl.getBoundingClientRect(), DROP_PAD);
}

function endButtonDrag(e) {
    if (!btnDrag || e.pointerId !== btnDrag.id) return;
    const d = btnDrag;
    btnDrag = null;
    drop(d.el);
    withoutObserving(() => {
        popoverEl.classList.remove('stf-drop-target');
        folderEl.classList.remove('stf-drop-target');
    });

    if (d.moved && e.type === 'pointerup') {
        const settings = getSettings();
        const entry = (settings.buttons[d.key] ??= { mode: 'folder', label: '' });
        const x = e.clientX;
        const y = e.clientY;

        if (isOverFolder(x, y)) {
            // В папку: на место ближайшей ячейки (над самой папкой — в конец).
            entry.mode = 'folder';
            delete entry.pos;
            const others = lastSlots.filter((s) => s.key !== d.key);
            const overGrid = isOpen && pointInRect(x, y, popoverEl.getBoundingClientRect());
            const index = overGrid && others.length ? nearestSlot(others, x, y) : others.length;
            settings.order = moveInOrder(settings.order, others.map((s) => s.key), d.key, index);
        } else {
            // На экран: туда, куда бросили.
            entry.mode = 'screen';
            entry.pos = rectToPos(x - d.offX, y - d.offY, d.width, d.height, window.innerWidth, window.innerHeight);
        }
        saveSettings();
        // Перескан сам вызовет sync и заодно перерисует галочки «в папке» в панели.
        rescanNow();
        return;
    }
    sync();
}

// Глушит события нажатия на чужих кнопках в режиме «Упорядочить» и ведёт по ним наше
// перетаскивание. window + capture — раньше любых обработчиков расширения.
function bindArrangeInterception() {
    const swallow = (e) => {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
    };

    window.addEventListener('pointerdown', (e) => {
        const el = arrangeableAt(e.target);
        if (!el) return;
        swallow(e);
        startButtonDrag(e, el);
    }, true);

    window.addEventListener('pointermove', (e) => {
        if (!btnDrag) return;
        swallow(e);
        moveButtonDrag(e);
    }, true);

    for (const type of ['pointerup', 'pointercancel']) {
        window.addEventListener(type, (e) => {
            if (!btnDrag) return;
            swallow(e);
            endButtonDrag(e);
        }, true);
    }

    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend']) {
        window.addEventListener(type, (e) => {
            if (arrangeableAt(e.target) || (btnDrag && type.startsWith('touch'))) swallow(e);
        }, { capture: true, passive: false });
    }
}

// --- Перетаскивание и тап по папке ---

function bindFolderPointer() {
    let start = null;
    let pressTimer = null;

    folderEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = folderEl.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, id: e.pointerId, dragging: false, pressed: false };
        // Захват может бросить исключение (указатель уже неактивен) — без него драг всё
        // равно работает, пока палец над папкой, а долгое нажатие не должно ломаться.
        try {
            folderEl.setPointerCapture(e.pointerId);
        } catch {
            // ignore
        }
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            if (!start || start.dragging) return;
            start.pressed = true;
            setArranging(true);
        }, LONG_PRESS_MS);
    });

    folderEl.addEventListener('pointermove', (e) => {
        if (!start || e.pointerId !== start.id) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.dragging && !isDrag(dx, dy)) return;
        if (!start.dragging) {
            start.dragging = true;
            clearTimeout(pressTimer);
            close();
            folderEl.classList.add('stf-dragging');
        }
        const size = folderSize();
        const { left, top } = posToPixels(
            pixelsToPos(start.left + dx, start.top + dy, window.innerWidth, window.innerHeight, size),
            window.innerWidth,
            window.innerHeight,
            size,
        );
        withoutObserving(() => {
            folderEl.style.left = `${left}px`;
            folderEl.style.top = `${top}px`;
        });
    });

    const finish = (e) => {
        if (!start || e.pointerId !== start.id) return;
        clearTimeout(pressTimer);
        const { dragging, pressed } = start;
        start = null;
        folderEl.classList.remove('stf-dragging');
        if (dragging) {
            const rect = folderEl.getBoundingClientRect();
            getSettings().pos = pixelsToPos(rect.left, rect.top, window.innerWidth, window.innerHeight, folderSize());
            saveSettings();
        } else if (e.type === 'pointerup' && !pressed) {
            toggle();
        }
    };
    folderEl.addEventListener('pointerup', finish);
    folderEl.addEventListener('pointercancel', finish);
    // Долгое нажатие на телефоне иначе открывает контекстное меню / выделение.
    folderEl.addEventListener('contextmenu', (e) => e.preventDefault());

    folderEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });
}

// --- Закрытие ---

function isInsideFolder(node) {
    if (folderEl.contains(node) || popoverEl.contains(node) || isManaged(node)) return true;
    return !!arrangeableAt(node);
}

function bindClosing() {
    // Нажатие мимо папки, поповера и кнопок в нём — закрыть. Capture: чтобы успеть до
    // чужих обработчиков, которые могут остановить всплытие.
    document.addEventListener('pointerdown', (e) => {
        if (isOpen && !isInsideFolder(e.target)) close();
    }, true);

    // Тап по кнопке в папке: дать ей отработать, потом закрыть. Закрываем после click, а
    // не на pointerdown — иначе кнопка спряталась бы раньше, чем расширение её услышит.
    document.addEventListener('click', (e) => {
        if (isOpen && !arranging && isManaged(e.target)) {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(close, 0);
        }
    });
    document.addEventListener('pointerup', (e) => {
        if (isOpen && !arranging && isManaged(e.target)) {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(close, CLOSE_AFTER_POINTERUP_MS);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            close();
            folderEl.focus({ preventScroll: true });
        }
    });

    window.addEventListener('resize', () => {
        if (!folderEl.hidden) {
            applyPosition();
            if (isOpen) layout();
        }
    });
}

export function initFolder() {
    if (folderEl) return;
    createElements();
    bindFolderPointer();
    bindArrangeInterception();
    bindClosing();
    onScan((scan) => sync(scan));
    sync();
}
