// Чистая логика мержа и валидации настроек STFolder — без DOM и без getCtx(), поэтому
// тестируется напрямую под node. Дефолты заморожены, недостающие ключи домерживаются
// при чтении, битые — чинятся.

import { VIEW_MODES } from './proxy-core.js';
import { DEFAULT_ICON, DEFAULT_STYLE, FOLDER_SIZE, ICON_IDS, RENAMED_ICONS, SIZE_LIMITS, STYLE_IDS } from './folder-core.js';

export const MODULE_NAME = 'STFolder';
export const SETTINGS_VERSION = 1;

// Дефолты верхнего уровня STFolder.
//   version    — номер схемы настроек (для будущих миграций)
//   enabled    — расширение включено
//   mobileOnly — работать только на мобильном (ширина ≤ 1000 px, брейкпоинт ST)
//   pos        — позиция папки кнопок на экране, null — ещё не переставлялась
//   buttons    — режим/видимость найденных кнопок по их ключу, { [key]: {...} }
//   manual     — селекторы кнопок, добавленных вручную
//   icon       — иконка папки (id из ICONS в folder-core.js)
//   style      — стиль папки (id из STYLES)
//   size       — диаметр папки в px (SIZE_LIMITS)
//   order      — ключи кнопок в порядке показа в папке
export const DEFAULTS = Object.freeze({
    version: SETTINGS_VERSION,
    enabled: true,
    mobileOnly: false,
    pos: null,
    buttons: {},
    manual: [],
    icon: DEFAULT_ICON,
    style: DEFAULT_STYLE,
    size: FOLDER_SIZE,
    order: [],
});

export function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

// Позиция — доли вьюпорта 0..1 (см. folder-core.js).
function isValidPos(value) {
    if (value === null) return true;
    const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    return isPlainObject(value) && ok(value.x) && ok(value.y);
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// Валидаторы по ключу верхнего уровня. Ключ без валидатора (version) только
// домерживается, если отсутствует, — но не чинится, если стоит что-то другое:
// это внутренний номер схемы, руками его никто не правит.
const VALIDATORS = Object.freeze({
    enabled: (v) => typeof v === 'boolean',
    mobileOnly: (v) => typeof v === 'boolean',
    pos: isValidPos,
    buttons: isPlainObject,
    manual: isStringArray,
    icon: (v) => ICON_IDS.includes(v),
    style: (v) => STYLE_IDS.includes(v),
    size: (v) => Number.isInteger(v) && v >= SIZE_LIMITS.min && v <= SIZE_LIMITS.max,
    order: isStringArray,
});

// --- Записи о кнопках ---
//
// settings.buttons[key] = { mode, label, pos? }:
//   mode  — 'folder' (прятать в папку) или 'screen' (оставить на экране);
//   label — подпись для панели, чтобы кнопку можно было узнать, даже когда её сейчас нет;
//   pos   — только у кнопок, вытащенных из папки перетаскиванием: куда их бросили
//           (доли вьюпорта, как у папки). Нет pos — кнопка стоит там, где её ставит
//           само расширение;
//   view  — как показывать в папке: 'auto' | 'live' | 'proxy' (proxy-core.js); нет поля —
//           auto.
// Новая найденная кнопка по умолчанию идёт в папку — ради этого расширение и ставят.
export const BUTTON_MODES = Object.freeze(['folder', 'screen']);
export const DEFAULT_BUTTON_MODE = 'folder';
const MAX_LABEL_LENGTH = 60;

// Чинит одну запись: неизвестный режим → дефолт, подпись — строка. null — выбросить.
export function normalizeButtonEntry(entry) {
    if (!isPlainObject(entry)) return null;
    if (!BUTTON_MODES.includes(entry.mode)) entry.mode = DEFAULT_BUTTON_MODE;
    if (typeof entry.label !== 'string') entry.label = '';
    if ('pos' in entry && (entry.pos === null || !isValidPos(entry.pos))) delete entry.pos;
    if ('view' in entry && !VIEW_MODES.includes(entry.view)) delete entry.view;
    return entry;
}

function sanitizeButtons(buttons) {
    for (const key of Object.keys(buttons)) {
        if (!key || !normalizeButtonEntry(buttons[key])) delete buttons[key];
    }
}

// Заносит найденные кнопки (`[{ key, label }]`) в settings.buttons: новые — с режимом по
// умолчанию, у известных обновляет подпись. Режим, выбранный пользователем, не трогает.
// Возвращает true, если что-то поменялось, — тогда настройки стоит сохранить.
export function rememberButtons(buttons, found) {
    let changed = false;
    for (const { key, label } of found) {
        if (!key) continue;
        const text = typeof label === 'string' ? label.slice(0, MAX_LABEL_LENGTH) : '';
        const entry = buttons[key];
        if (!entry) {
            buttons[key] = { mode: DEFAULT_BUTTON_MODE, label: text };
            changed = true;
        } else if (text && entry.label !== text) {
            entry.label = text;
            changed = true;
        }
    }
    return changed;
}

// --- Кнопки, добавленные вручную ---
//
// settings.manual — их ключи (селекторы). Детектор берёт такие элементы без эвристики.
// Вместе с ключом заводится запись в buttons, как у найденной кнопки: в папку.

export function addManual(settings, key, label = '') {
    if (!key) return false;
    const fresh = !settings.manual.includes(key);
    if (fresh) settings.manual.push(key);
    settings.buttons[key] ??= { mode: DEFAULT_BUTTON_MODE, label: label.slice(0, MAX_LABEL_LENGTH) };
    settings.buttons[key].mode = DEFAULT_BUTTON_MODE;
    delete settings.buttons[key].pos;
    return fresh;
}

export function removeManual(settings, key) {
    const before = settings.manual.length;
    settings.manual = settings.manual.filter((k) => k !== key);
    delete settings.buttons[key];
    settings.order = settings.order.filter((k) => k !== key);
    return settings.manual.length !== before;
}

// Сброс всего к дефолтам (кнопка «Сбросить всё»). Живой объект сохраняется — на него
// держат ссылки модули, — меняется только содержимое.
export function resetSettings(settings, defaults = DEFAULTS) {
    for (const key of Object.keys(settings)) delete settings[key];
    Object.assign(settings, structuredClone(defaults));
    return settings;
}

// Возвращает живой (не клонированный) объект настроек — создаёт контейнер `root[key]`
// при первом обращении и чинит его при каждом чтении: settings.json игрок может
// править руками, и любое битое поле заменяется свежим дефолтом, а не роняет панель.
export function getOrCreateSettings(root, key = MODULE_NAME, defaults = DEFAULTS) {
    if (!isPlainObject(root)) {
        throw new Error('getOrCreateSettings: root должен быть обычным объектом');
    }

    if (!isPlainObject(root[key])) {
        root[key] = structuredClone(defaults);
    }
    const settings = root[key];

    // Иконку убрали из каталога — подставить замену до валидации, иначе она сбросится
    // на папку по умолчанию.
    if (Object.hasOwn(RENAMED_ICONS, settings.icon)) settings.icon = RENAMED_ICONS[settings.icon];

    for (const field of Object.keys(defaults)) {
        if (!Object.hasOwn(settings, field)) {
            settings[field] = structuredClone(defaults[field]);
            continue;
        }
        const validate = VALIDATORS[field];
        if (validate && !validate(settings[field])) {
            settings[field] = structuredClone(defaults[field]);
        }
    }

    sanitizeButtons(settings.buttons);

    return settings;
}
