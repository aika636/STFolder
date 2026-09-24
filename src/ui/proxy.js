// Прокси-режим: в ячейке папки — копия чужой кнопки, нажатие на копию
// пересылается оригиналу. Для кнопок, которые живое размещение не берёт (инлайновый
// style="… !important" сильнее нашего @layer — кнопка не встаёт в ячейку).
//
// Копия — cloneNode без id и inline-обработчиков, с перенесёнными вычисленными стилями
// (стили расширения по #id на копию без id не действуют). Оригинал в это время спрятан;
// на время снимка и пересылки нажатия он на мгновение возвращается в естественный вид
// (withNaturalState) — синхронно, так что на экране этого не видно, а обработчики
// расширения видят кнопку там, где она у них обычно стоит.

import { COPY_CHILD_EXTRA_PROPS, COPY_STYLE_PROPS, tapSequence } from '../core/proxy-core.js';
import { logError } from '../log.js';
import { OWN_ATTR, rescanNow, withNaturalState, withoutObserving } from './detector.js';

const REFRESH_DEBOUNCE_MS = 120;
// pointerId для синтетических pointer-событий: не пересекается с настоящими (0, 1, 2…).
const SYNTH_POINTER_ID = 7331;

// key → { cell, el, observer, timer }
const proxies = new Map();

function copyStyles(from, to, props) {
    const cs = getComputedStyle(from);
    for (const prop of props) {
        to.style.setProperty(prop, cs.getPropertyValue(prop));
    }
}

function stripClone(node) {
    if (node.nodeType !== 1) return;
    node.removeAttribute('id');
    node.removeAttribute(OWN_ATTR);
    for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
    }
}

// Снимок оригинала: глубокая копия, на каждый узел — его вычисленные стили.
function snapshot(el) {
    return withNaturalState(el, () => {
        const clone = el.cloneNode(true);
        const originals = [el, ...el.querySelectorAll('*')];
        const copies = [clone, ...clone.querySelectorAll('*')];

        originals.forEach((orig, i) => {
            const copy = copies[i];
            if (!copy) return;
            copy.removeAttribute('style');
            copyStyles(orig, copy, i === 0 ? COPY_STYLE_PROPS : [...COPY_STYLE_PROPS, ...COPY_CHILD_EXTRA_PROPS]);
            stripClone(copy);
        });

        // Классы корня снимаем: его внешность уже перенесена инлайном, а правила
        // расширения для этих классов (`.my-fab { position: fixed !important; … }`)
        // унесли бы копию из ячейки. У потомков классы остаются — на них держатся
        // иконки (FA рисует глиф через ::before по классу).
        clone.removeAttribute('class');

        // Копия стоит в ячейке и сама событий не ловит — их ловит ячейка.
        clone.style.setProperty('position', 'relative', 'important');
        clone.style.setProperty('inset', 'auto', 'important');
        clone.style.setProperty('margin', '0', 'important');
        clone.style.setProperty('transform', 'none', 'important');
        clone.style.setProperty('pointer-events', 'none', 'important');
        return clone;
    });
}

function refresh(key) {
    const p = proxies.get(key);
    if (!p) return;
    try {
        p.cell.replaceChildren(snapshot(p.el));
    } catch (err) {
        logError(`снимок копии ${key} упал`, err);
    }
    // Свои правки (снятие классов на время снимка) — не повод обновлять копию снова.
    p.observer.takeRecords();
}

function scheduleRefresh(key) {
    const p = proxies.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => refresh(key), REFRESH_DEBOUNCE_MS);
}

// --- Пересылка нажатия ---

function jqueryEventTypes(node) {
    try {
        const events = window.jQuery?._data?.(node, 'events');
        return events ? Object.keys(events) : [];
    } catch {
        return [];
    }
}

function listenerHints(el, target) {
    const types = new Set();
    for (let n = target; n && n !== el.parentElement; n = n.parentElement) {
        for (const t of jqueryEventTypes(n)) types.add(t);
    }
    return {
        hasMouse: [...types].some((t) => /^mouse|^click/.test(t)),
        hasTouch: [...types].some((t) => /^touch/.test(t)),
        touchSupported: typeof TouchEvent === 'function' && typeof Touch === 'function',
    };
}

function makeEvent(type, target, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
    const down = /down|start/.test(type);
    if (type.startsWith('pointer')) {
        return new PointerEvent(type, {
            ...base, pointerId: SYNTH_POINTER_ID, pointerType: 'mouse', isPrimary: true,
            button: 0, buttons: down ? 1 : 0,
        });
    }
    if (type.startsWith('touch')) {
        const touch = new Touch({ identifier: SYNTH_POINTER_ID, target, clientX: x, clientY: y });
        const touches = type === 'touchend' ? [] : [touch];
        return new TouchEvent(type, { ...base, touches, targetTouches: touches, changedTouches: [touch] });
    }
    return new MouseEvent(type, { ...base, button: 0, buttons: down ? 1 : 0, detail: type === 'click' ? 1 : 0 });
}

// Нажатие на копию → та же цепочка событий на оригинале, в точке, соответствующей месту
// нажатия внутри копии (так попадаем во вложенную кнопку обёртки, вроде кнопки внутри
// FAB с бейджем).
function tapThrough(key, clientX, clientY) {
    const p = proxies.get(key);
    if (!p?.el.isConnected) return;
    const cellRect = p.cell.getBoundingClientRect();
    const relX = clientX - cellRect.left;
    const relY = clientY - cellRect.top;

    withNaturalState(p.el, () => {
        const rect = p.el.getBoundingClientRect();
        const x = rect.left + Math.min(Math.max(relX, 1), Math.max(rect.width - 1, 1));
        const y = rect.top + Math.min(Math.max(relY, 1), Math.max(rect.height - 1, 1));
        const target = document.elementsFromPoint(x, y).find((n) => p.el.contains(n)) ?? p.el;

        for (const type of tapSequence(listenerHints(p.el, target))) {
            try {
                target.dispatchEvent(makeEvent(type, target, x, y));
            } catch (err) {
                logError(`пересылка ${type} на ${key} упала`, err);
            }
        }
    });

    // Мутации, которые обработчики расширения сделали внутри withNaturalState, детектор
    // не увидел (withoutObserving) — пересканировать самим. И обновить копию: нажатие
    // обычно меняет вид кнопки.
    setTimeout(() => {
        rescanNow();
        refresh(key);
    }, 60);
}

// --- Ячейки ---

// Ячейка-копия для кнопки. onTap(key) — после пересылки нажатия (папка закроется).
export function ensureProxy(button, parent, onTap) {
    let p = proxies.get(button.key);
    if (p && p.el !== button.el) {
        disposeProxy(button.key);
        p = null;
    }
    if (!p) {
        const cell = document.createElement('div');
        cell.setAttribute(OWN_ATTR, '');
        cell.className = 'stf-proxy';
        cell.dataset.key = button.key;
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.title = button.label;
        cell.setAttribute('aria-label', button.label);

        cell.addEventListener('click', (e) => {
            if (cell.classList.contains('stf-arrangeable')) return;
            tapThrough(button.key, e.clientX, e.clientY);
            onTap?.(button.key);
        });
        cell.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            const r = cell.getBoundingClientRect();
            tapThrough(button.key, r.left + r.width / 2, r.top + r.height / 2);
            onTap?.(button.key);
        });

        const observer = new MutationObserver(() => scheduleRefresh(button.key));
        p = { cell, el: button.el, observer, timer: null };
        proxies.set(button.key, p);
        withoutObserving(() => parent.appendChild(cell));
    }
    return p.cell;
}

// Папка открылась — снять свежие копии и следить за оригиналами (бейджи, иконки).
export function activateProxies() {
    for (const [key, p] of proxies) {
        refresh(key);
        p.observer.observe(p.el, { subtree: true, childList: true, characterData: true, attributes: true });
    }
}

// Папка закрылась — следить незачем.
export function deactivateProxies() {
    for (const p of proxies.values()) {
        p.observer.disconnect();
        clearTimeout(p.timer);
    }
}

export function disposeProxy(key) {
    const p = proxies.get(key);
    if (!p) return;
    p.observer.disconnect();
    clearTimeout(p.timer);
    withoutObserving(() => p.cell.remove());
    proxies.delete(key);
}

// Убирает ячейки кнопок, которых больше нет среди показываемых копией.
export function keepProxies(keys) {
    for (const key of [...proxies.keys()]) {
        if (!keys.has(key)) disposeProxy(key);
    }
}

export function proxyCell(key) {
    return proxies.get(key)?.cell ?? null;
}

export function proxyKeyOf(node) {
    const cell = node instanceof Element ? node.closest('.stf-proxy') : null;
    return cell?.dataset.key ?? null;
}
