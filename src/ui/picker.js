// Ручной выбор кнопки: для плавающих кнопок, которые детектор не узнал по
// общим признакам. Включается из панели, wand-меню или `/stfolder pick`. Пока режим
// включён, нажатия по странице глушатся на window в capture (расширение ничего не
// получает), под курсором рамка — что будет взято; тап добавляет элемент в папку.

import { pickTarget } from '../core/picker-core.js';
import { buttonKey, buttonLabel } from '../core/detector-core.js';
import { toast } from '../ctx.js';
import { addManual } from '../core/settings-core.js';
import { logError } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { CORE_SELECTOR, OWN_ATTR, describeElement, getLastScan, rescanNow, withoutObserving } from './detector.js';

let active = false;
let bannerEl = null;
let frameEl = null;
const cleanups = [];

function own(el) {
    el.setAttribute(OWN_ATTR, '');
    return el;
}

// Цепочка описаний от элемента под пальцем вверх до ребёнка body (для pickTarget).
function chainFrom(node) {
    const chain = [];
    const els = [];
    for (let el = node instanceof Element ? node : node?.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        els.push(el);
        chain.push({
            position: getComputedStyle(el).position,
            inCore: el.matches(CORE_SELECTOR),
            own: el.hasAttribute(OWN_ATTR),
        });
    }
    return { chain, els };
}

// Что возьмём под точкой: { el } или { reason }.
function resolve(x, y) {
    // Своя рамка и плашка событий не ловят (pointer-events: none / вне точки), но на всякий
    // случай берём первый чужой элемент под точкой.
    const node = document.elementsFromPoint(x, y).find((n) => !n.closest(`[${OWN_ATTR}]`) || n.closest('.stf-folder, .stf-popover'));
    if (!node) return { reason: 'мимо' };
    const { chain, els } = chainFrom(node);
    const picked = pickTarget(chain);
    return picked.reason ? picked : { el: els[picked.index] };
}

function showFrame(target) {
    if (!frameEl) return;
    withoutObserving(() => {
        // Под курсором ничего подходящего — рамку прячем (почему не подходит, скажет тост
        // по нажатию).
        if (!target?.el) {
            frameEl.hidden = true;
            return;
        }
        const r = target.el.getBoundingClientRect();
        Object.assign(frameEl.style, {
            left: `${r.left - 4}px`,
            top: `${r.top - 4}px`,
            width: `${r.width + 8}px`,
            height: `${r.height + 8}px`,
        });
        frameEl.hidden = false;
    });
}

function take(target) {
    if (target.reason) {
        toast('warning', `Не подходит: ${target.reason}.`);
        return false;
    }
    const el = target.el;
    const already = getLastScan().found.find((b) => b.el === el);
    if (already) {
        toast('info', `«${already.label}» уже найдена — она в списке кнопок.`);
        return true;
    }

    const desc = describeElement(el, 0);
    const key = buttonKey(desc);
    if (!key) {
        toast('warning', 'У этого элемента нет ни id, ни постоянных классов — запомнить его не получится.');
        return false;
    }
    const label = buttonLabel(desc, key);
    addManual(getSettings(), key, label);
    saveSettings();
    rescanNow();
    toast('success', `«${label}» добавлена в папку.`);
    return true;
}

export function isPicking() {
    return active;
}

export function startPicking() {
    if (active) return;
    active = true;

    // Меню расширений на телефоне закрывает весь экран — убрать, чтобы было куда тапнуть.
    const drawer = document.getElementById('rm_extensions_block');
    if (drawer?.classList.contains('openDrawer')) {
        document.querySelector('#extensions-settings-button .drawer-toggle')?.click();
    }

    bannerEl = own(document.createElement('div'));
    bannerEl.className = 'stf-pick-banner';
    bannerEl.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'Нажмите на плавающую кнопку, которую убрать в папку';
    const cancel = document.createElement('div');
    cancel.className = 'menu_button stf-pick-cancel';
    cancel.textContent = 'Отмена';
    bannerEl.append(text, cancel);

    frameEl = own(document.createElement('div'));
    frameEl.className = 'stf-pick-frame';
    frameEl.hidden = true;

    withoutObserving(() => document.body.append(frameEl, bannerEl));

    const inBanner = (e) => bannerEl?.contains(e.target);
    const swallow = (e) => {
        e.stopImmediatePropagation();
        if (e.cancelable) e.preventDefault();
    };

    const listen = (type, handler, opts = { capture: true, passive: false }) => {
        window.addEventListener(type, handler, opts);
        cleanups.push(() => window.removeEventListener(type, handler, opts));
    };

    listen('pointermove', (e) => {
        if (inBanner(e)) return;
        showFrame(resolve(e.clientX, e.clientY));
    });

    listen('pointerup', (e) => {
        if (inBanner(e)) {
            if (cancel.contains(e.target)) stopPicking();
            return;
        }
        swallow(e);
        try {
            if (take(resolve(e.clientX, e.clientY))) stopPicking();
        } catch (err) {
            logError('ручной выбор упал', err);
            stopPicking();
        }
    });

    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'touchend']) {
        listen(type, (e) => {
            if (!inBanner(e)) swallow(e);
        });
    }

    listen('keydown', (e) => {
        if (e.key === 'Escape') {
            swallow(e);
            stopPicking();
        }
    });
}

export function stopPicking() {
    if (!active) return;
    active = false;
    while (cleanups.length) cleanups.pop()();
    withoutObserving(() => {
        bannerEl?.remove();
        frameEl?.remove();
    });
    bannerEl = null;
    frameEl = null;
}
