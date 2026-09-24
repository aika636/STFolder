// Детектор плавающих кнопок: обходит верх DOM, собирает про каждый закреплённый элемент
// плоское описание и отдаёт его ядру (src/core/detector-core.js) на решение. Про
// конкретные расширения здесь ничего нет — только общие признаки.
//
// Расширения грузятся в разное время, кнопки появляются и исчезают по своим правилам
// (одни показываются только в открытом чате, другие выбирают вид для ПК или телефона
// при загрузке), поэтому скан не разовый: MutationObserver на body + дебаунс, плюс
// отложенный перескан, чтобы новичок, отсеянный как «только что появился», дозрел.

import { CORE_SELECTORS, LIMITS, buttonKey, buttonLabel, classifyCandidate } from '../core/detector-core.js';
import { logError, warnOnce } from '../log.js';
import { getSettings } from '../settings.js';

export const CORE_SELECTOR = CORE_SELECTORS.join(',');
// Свои элементы (папка, поповер, подсветка) помечены атрибутом. По классам stf-* их
// узнавать нельзя: классы stf-hidden/stf-docked мы вешаем и на чужие кнопки.
export const OWN_ATTR = 'data-stf-own';
const OWN_SELECTOR = `[${OWN_ATTR}]`;

// Классы, которыми папка управляет чужими кнопками (src/ui/dock.js). Детектор оценивает
// кнопку без них — иначе спрятанная нами кнопка выглядела бы «скрытой расширением».
export const DOCK_CLASSES = Object.freeze(['stf-hidden', 'stf-docked', 'stf-placed', 'stf-lifted', 'stf-arrangeable', 'stf-proxied']);
const DEBOUNCE_MS = 300;
// Сколько потомков смотреть в поисках признаков «нажимаемости» — кнопка обычно
// состоит из самой кнопки и иконки внутри, глубже искать незачем.
const INTERACTIVE_PROBE_LIMIT = 24;

// Когда мы впервые увидели элемент. WeakMap — чтобы не держать удалённые узлы.
const firstSeen = new WeakMap();

function isPositioned(style) {
    return style.position === 'fixed' || style.position === 'absolute';
}

function hasJqueryHandlers(el) {
    try {
        const events = window.jQuery?._data?.(el, 'events');
        return !!events && Object.keys(events).some((type) => /click|mouse|touch|pointer/.test(type));
    } catch {
        return false;
    }
}

function looksInteractive(el) {
    const probe = [el, ...Array.from(el.querySelectorAll('*')).slice(0, INTERACTIVE_PROBE_LIMIT)];
    for (const node of probe) {
        const tag = node.tagName;
        if (tag === 'BUTTON' || (tag === 'A' && node.hasAttribute('href'))) return true;
        if (node.getAttribute('role') === 'button') return true;
        if (typeof node.onclick === 'function' || node.hasAttribute('onclick')) return true;
        if (getComputedStyle(node).cursor === 'pointer') return true;
        if (hasJqueryHandlers(node)) return true;
    }
    // Обработчики через addEventListener снаружи не видны. Последняя подсказка — стили
    // перетаскивания (touch-action / user-select: none на самом элементе): так делают
    // почти все перетаскиваемые FAB'ы, а декоративные блоки — нет.
    const style = getComputedStyle(el);
    return style.touchAction === 'none' || style.cursor === 'grab' || style.cursor === 'move';
}

function isVisible(el, style, rect) {
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) < 0.05) return false;
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Спрятан за край экрана — для пользователя его нет.
    return rect.right > 0 && rect.bottom > 0 && rect.left < window.innerWidth && rect.top < window.innerHeight;
}

// Кнопки, которые dock.js спрятал инлайновым `display: none !important` (стили
// расширения оказались сильнее даже @layer): el → { value, priority } — что стояло в
// инлайновом display до нас. Нужно, чтобы вернуть как было и чтобы детектор видел
// кнопку такой, какой её задумало расширение.
export const forcedDisplay = new WeakMap();

// Выполняет fn, пока кнопка в «естественном» виде: без наших классов и без нашего
// принудительного display. Всё синхронно — браузер между этим не рисует, мигания нет.
// Пользуются детектор (замер), прокси (снимок копии и пересылка нажатия).
export function withNaturalState(el, fn) {
    const ours = DOCK_CLASSES.filter((cls) => el.classList.contains(cls));
    let forced = forcedDisplay.get(el);
    if (forced) {
        // Расширение поверх нас переписало инлайновый display (jQuery .show()/.hide()) —
        // значит, его «естественное» желание теперь такое.
        const value = el.style.getPropertyValue('display');
        const priority = el.style.getPropertyPriority('display');
        if (!(value === 'none' && priority === 'important')) {
            forced = { value, priority };
            forcedDisplay.set(el, forced);
        }
    }
    if (ours.length === 0 && !forced) return fn();

    let result;
    withoutObserving(() => {
        el.classList.remove(...ours);
        if (forced) el.style.setProperty('display', forced.value, forced.priority);
        try {
            result = fn();
        } finally {
            if (forced) el.style.setProperty('display', 'none', 'important');
            el.classList.add(...ours);
        }
    });
    return result;
}

// Плоское описание элемента для classifyCandidate. Всё, что зависит от DOM, — здесь.
// Кнопку меряем в естественном виде — иначе спрятанная нами выглядела бы «скрытой
// расширением».
export function describeElement(el, depth, now = Date.now()) {
    const desc = withNaturalState(el, () => describeRaw(el, depth, now));
    desc.classes = desc.classes.filter((cls) => !DOCK_CLASSES.includes(cls));
    return desc;
}

function describeRaw(el, depth, now) {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    if (!firstSeen.has(el)) firstSeen.set(el, now);

    let positionedAncestor = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (isPositioned(getComputedStyle(p))) {
            positionedAncestor = true;
            break;
        }
    }

    const visible = isVisible(el, style, rect);
    return {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: Array.from(el.classList),
        role: el.getAttribute('role') || '',
        title: el.getAttribute('title') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        depth,
        position: style.position,
        positionedAncestor,
        visible,
        width: rect.width,
        height: rect.height,
        x: rect.left,
        y: rect.top,
        zIndex: style.zIndex,
        textLength: visible ? (el.innerText || '').replace(/\s+/g, '').length : 0,
        interactive: visible && looksInteractive(el),
        inCore: !!el.closest(CORE_SELECTOR),
        own: el.matches(OWN_SELECTOR),
        ageMs: now - firstSeen.get(el),
    };
}

// Обходит детей body до LIMITS.maxDepth. В ядро ST и в уже закреплённые блоки не
// спускаемся: закреплённый блок — единица сам по себе, а ядро огромное (чат).
function collectPositioned() {
    const out = [];
    const walk = (parent, depth) => {
        for (const el of parent.children) {
            if (el.matches('script, style, link, template, noscript')) continue;
            if (el.matches(CORE_SELECTOR)) continue;
            if (isPositioned(getComputedStyle(el))) {
                out.push({ el, depth });
                continue;
            }
            if (depth < LIMITS.maxDepth) walk(el, depth + 1);
        }
    };
    walk(document.body, 0);
    return out;
}

// Один проход. found — кандидаты с ключами, rejected — остальные закреплённые элементы
// с причиной (для диагностики в панели).
export function scanButtons() {
    const now = Date.now();
    const found = [];
    const rejected = [];
    const seenKeys = new Set();

    // Добавленные вручную — без эвристики: пользователь сам сказал, что это
    // кнопка. Отсекаем только невидимые, своё и ядро ST.
    const manualEls = new Set();
    for (const key of manualKeys()) {
        let el = null;
        try {
            el = document.querySelector(key);
        } catch {
            warnOnce(`bad-manual:${key}`, `ключ ручной кнопки не разобрался как селектор: ${key}`);
        }
        if (!el || seenKeys.has(key)) continue;
        manualEls.add(el);
        let desc;
        try {
            desc = describeElement(el, depthOf(el), now);
        } catch (err) {
            logError('describeElement упал', err);
            continue;
        }
        let reason = null;
        if (desc.own) reason = 'свой элемент STFolder';
        else if (desc.inCore) reason = 'ядро SillyTavern';
        else if (!desc.visible) reason = 'скрыт';
        if (reason) {
            rejected.push({ el, desc, key, reason, manual: true });
            continue;
        }
        seenKeys.add(key);
        found.push({ el, desc, key, label: buttonLabel(desc, key), manual: true });
    }

    for (const { el, depth } of collectPositioned()) {
        if (manualEls.has(el)) continue;
        let desc;
        try {
            desc = describeElement(el, depth, now);
        } catch (err) {
            logError('describeElement упал', err);
            continue;
        }

        const verdict = classifyCandidate(desc);
        const key = buttonKey(desc);

        if (verdict.ok && !key) {
            rejected.push({ el, desc, key, reason: 'нет стабильного ключа' });
            continue;
        }
        if (verdict.ok && seenKeys.has(key)) {
            warnOnce(`dup:${key}`, `две кнопки с одним ключом ${key} — беру первую`);
            rejected.push({ el, desc, key, reason: 'дубль ключа' });
            continue;
        }

        if (verdict.ok) {
            seenKeys.add(key);
            found.push({ el, desc, key, label: buttonLabel(desc, key) });
        } else {
            rejected.push({ el, desc, key, reason: verdict.reason });
        }
    }

    return { at: now, found, rejected };
}

function manualKeys() {
    try {
        return getSettings().manual;
    } catch {
        return [];
    }
}

function depthOf(el) {
    let depth = 0;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) depth++;
    return depth;
}

// --- Наблюдение ---

let observer = null;

// Выполняет правку DOM, которую наблюдатель не должен принять за чужую: записи
// мутаций, накопленные за время fn, выбрасываются. Нужна dock.js и самому детектору.
export function withoutObserving(fn) {
    try {
        return fn();
    } finally {
        observer?.takeRecords();
    }
}
let debounceTimer = null;
let ripenTimer = null;
let lastScan = { at: 0, found: [], rejected: [] };
const listeners = new Set();

function foundSignature(scan) {
    return scan.found.map((b) => b.key).sort().join('|');
}

function runScan() {
    let scan;
    try {
        scan = scanButtons();
    } catch (err) {
        logError('скан кнопок упал', err);
        return;
    }

    const changed = foundSignature(scan) !== foundSignature(lastScan);
    lastScan = scan;

    // Кто-то отсеян как «только что появился» — пересканировать, когда дозреет самый
    // старший из них. Считаем от его возраста, а не полные minAgeMs от этого скана:
    // иначе каждый промежуточный скан отодвигал бы дозревание, и новая кнопка
    // попадала бы в папку через 3–4 с вместо ~1.6.
    clearTimeout(ripenTimer);
    const young = scan.rejected.filter((r) => r.reason === 'только что появился');
    if (young.length) {
        const oldest = Math.max(...young.map((r) => r.desc.ageMs));
        ripenTimer = setTimeout(runScan, Math.max(LIMITS.minAgeMs - oldest, 0) + 50);
    }

    for (const listener of listeners) {
        try {
            listener(scan, changed);
        } catch (err) {
            logError('подписчик детектора упал', err);
        }
    }
}

function scheduleScan() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runScan, DEBOUNCE_MS);
}

// Мутации внутри чата (стриминг ответа) идут десятками в секунду и к плавающим кнопкам
// отношения не имеют — их отбрасываем до дебаунса, чтобы скан не откладывался вечно.
function isRelevantMutation(mutation) {
    const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
    if (!target) return false;
    if (target.closest('#chat, #sheld, #movingDivs, #top-settings-holder')) return false;
    if (target.closest(OWN_SELECTOR)) return false;
    if (mutation.type === 'childList') {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (nodes.length && nodes.every((n) => n.nodeType !== 1 || n.matches(OWN_SELECTOR))) return false;
    }
    return true;
}

export function startDetector() {
    if (observer) return;
    observer = new MutationObserver((mutations) => {
        if (mutations.some(isRelevantMutation)) scheduleScan();
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
    });
    // Поворот экрана и смена ширины меняют и видимость, и раскладку чужих кнопок.
    window.addEventListener('resize', scheduleScan);
    runScan();
}

export function stopDetector() {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('resize', scheduleScan);
    clearTimeout(debounceTimer);
    clearTimeout(ripenTimer);
}

export function rescanNow() {
    clearTimeout(debounceTimer);
    runScan();
    return lastScan;
}

export function getLastScan() {
    return lastScan;
}

// listener(scan, changed) — changed=true, если набор найденных ключей поменялся.
export function onScan(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
