// Живое размещение чужих кнопок. Оригинал в DOM не
// переносим и не клонируем — только вешаем классы (правила — в @layer stfolder-dock):
//   stf-hidden      — кнопка в закрытой папке (display: none);
//   stf-docked      — папка открыта, кнопка стоит в своей ячейке;
//   stf-placed      — кнопку вытащили из папки на экран, стоит там, куда бросили;
//   stf-lifted      — кнопку сейчас тащат пальцем/мышью в режиме «Упорядочить»;
//   stf-arrangeable — режим «Упорядочить»: кнопку можно тащить, её события глушатся;
//   stf-proxied     — в папке вместо кнопки копия (proxy.js), оригинал всегда спрятан.
// Если класс не прячет кнопку (у расширения style="display: … !important"), прячем
// инлайном `display: none !important`, запомнив прежнее значение (forcedDisplay), и
// возвращаем его, когда отпускаем кнопку.
// Координаты для docked/placed/lifted — в --stf-x/--stf-y. Палец в обычном режиме жмёт
// настоящую кнопку: срабатывают родные обработчики, бейджи и анимации. Инлайн-стили
// расширения не трогаем, поэтому отпущенная кнопка встаёт на своё место.

import { warnOnce } from '../log.js';
import { DOCK_CLASSES, forcedDisplay, withoutObserving } from './detector.js';

// Кнопки в папке: el → key.
const managed = new Map();
// Кнопки, вытащенные на экран: el → key.
const pinned = new Map();

function setVars(el, left, top) {
    el.style.setProperty('--stf-x', `${Math.round(left)}px`);
    el.style.setProperty('--stf-y', `${Math.round(top)}px`);
}

function clearVars(el) {
    el.style.removeProperty('--stf-x');
    el.style.removeProperty('--stf-y');
}

function forceHide(el) {
    if (!forcedDisplay.has(el)) {
        forcedDisplay.set(el, {
            value: el.style.getPropertyValue('display'),
            priority: el.style.getPropertyPriority('display'),
        });
    }
    el.style.setProperty('display', 'none', 'important');
}

function unforce(el) {
    const forced = forcedDisplay.get(el);
    if (!forced) return;
    forcedDisplay.delete(el);
    if (forced.value) el.style.setProperty('display', forced.value, forced.priority);
    else el.style.removeProperty('display');
}

function release(el) {
    el.classList.remove(...DOCK_CLASSES);
    clearVars(el);
    unforce(el);
}

// Класс stf-hidden не спрятал кнопку — прячем инлайном. Если не помогло и это, остаётся
// только предупредить (такого быть не должно: инлайн !important — вершина каскада).
function ensureHidden() {
    withoutObserving(() => {
        for (const [el, key] of managed) {
            if (!el.classList.contains('stf-hidden')) continue;
            if (getComputedStyle(el).display === 'none') continue;
            forceHide(el);
            if (getComputedStyle(el).display !== 'none') {
                warnOnce(`unhidden:${key}`, `не удалось спрятать ${key}`);
            }
        }
    });
}

// Приводит набор кнопок в папке к `buttons` ([{ el, key, proxy }]) и набор вытащенных на
// экран — к `placed` ([{ el, key, left, top }]). Новые в папке прячутся, выбывшие
// отпускаются. proxy — показывать копией: оригинал не ставится в ячейку.
export function syncDock(buttons, placed) {
    withoutObserving(() => {
        const inFolder = new Map(buttons.map((b) => [b.el, b.key]));
        const onScreen = new Map(placed.map((p) => [p.el, p]));

        for (const el of [...managed.keys(), ...pinned.keys()]) {
            if (!inFolder.has(el) && !onScreen.has(el) && !el.classList.contains('stf-lifted')) {
                release(el);
                managed.delete(el);
                pinned.delete(el);
            }
        }

        for (const b of buttons) {
            b.el.classList.toggle('stf-proxied', !!b.proxy);
            if (b.proxy && b.el.classList.contains('stf-docked')) {
                b.el.classList.remove('stf-docked');
                b.el.classList.add('stf-hidden');
                clearVars(b.el);
            }
        }

        for (const [el, key] of inFolder) {
            pinned.delete(el);
            el.classList.remove('stf-placed');
            if (!managed.has(el)) {
                managed.set(el, key);
                if (!el.classList.contains('stf-docked')) el.classList.add('stf-hidden');
            }
        }

        for (const [el, p] of onScreen) {
            managed.delete(el);
            pinned.set(el, p.key);
            if (el.classList.contains('stf-lifted')) continue;
            el.classList.remove('stf-hidden', 'stf-docked', 'stf-proxied');
            unforce(el);
            el.classList.add('stf-placed');
            setVars(el, p.left, p.top);
        }
    });
    ensureHidden();
}

// Ставит кнопки папки в ячейки поповера. placements — [{ el, left, top }] в пикселях.
export function placeAll(placements) {
    withoutObserving(() => {
        for (const { el, left, top } of placements) {
            if (!managed.has(el) || el.classList.contains('stf-lifted') || el.classList.contains('stf-proxied')) continue;
            setVars(el, left, top);
            unforce(el);
            el.classList.remove('stf-hidden');
            el.classList.add('stf-docked');
        }
    });
}

// Папка закрылась — кнопки папки снова прячутся.
export function stowAll() {
    withoutObserving(() => {
        for (const el of managed.keys()) {
            el.classList.remove('stf-docked', 'stf-lifted');
            el.classList.add('stf-hidden');
            clearVars(el);
        }
    });
    ensureHidden();
}

export function releaseAll() {
    withoutObserving(() => {
        for (const el of [...managed.keys(), ...pinned.keys()]) release(el);
        managed.clear();
        pinned.clear();
    });
}

// --- Режим «Упорядочить» ---

export function setArrangeable(els) {
    withoutObserving(() => {
        const set = new Set(els);
        for (const el of document.querySelectorAll('.stf-arrangeable')) {
            if (!set.has(el)) el.classList.remove('stf-arrangeable');
        }
        for (const el of set) el.classList.add('stf-arrangeable');
    });
}

// Кнопку подняли: она едет за пальцем поверх всего.
export function lift(el, left, top) {
    withoutObserving(() => {
        unforce(el);
        el.classList.remove('stf-hidden');
        el.classList.add('stf-lifted');
        setVars(el, left, top);
    });
}

export function drop(el) {
    withoutObserving(() => el.classList.remove('stf-lifted'));
}

// Кнопка в папке не встала в ячейку живьём — спрятать обратно и дальше показывать
// копией (stf-proxied: placeAll её больше не трогает).
export function hideAgain(el) {
    withoutObserving(() => {
        el.classList.remove('stf-docked');
        el.classList.add('stf-hidden', 'stf-proxied');
        clearVars(el);
    });
    ensureHidden();
}

// --- Запросы ---

function findIn(map, node) {
    for (const el of map.keys()) {
        if (el === node || el.contains(node)) return el;
    }
    return null;
}

export function isManaged(node) {
    return !!findIn(managed, node);
}

export function managedCount() {
    return managed.size;
}
