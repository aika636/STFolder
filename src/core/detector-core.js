// Чистое ядро детектора плавающих кнопок — без DOM и без SillyTavern. На вход получает
// «описание» элемента (обычный объект, его собирает src/ui/detector.js из живого DOM),
// на выход — решение «кандидат или нет» и причину. Так фильтр гоняется под node на
// таблице типичных кнопок (tests/core/detector.test.mjs).
//
// Детектор НЕ знает конкретных расширений: ни одного чужого id или класса здесь нет и
// быть не должно. Кнопка опознаётся по общим признакам плавающего лаунчера — закреплена
// на экране, маленькая, выглядит нажимаемой, живёт дольше мгновения, не часть ядра ST и
// не похожа на панель/модалку/тост. Всё, что эвристика пропустит или возьмёт лишнего,
// пользователь поправит руками (галочка «в папке», «Добавить вручную»).

// Ядро SillyTavern, которое никогда не трогаем. Элемент
// внутри любого из них — не кандидат, даже если он fixed и маленький.
export const CORE_SELECTORS = Object.freeze([
    '#top-settings-holder',
    '#top-bar',
    '#send_form',
    '#form_sheld',
    '#sheld',
    '#chat',
    '#movingDivs',
    '.draggable',
    '#character_popup',
    '#toast-container',
    'dialog',
    '.popup',
    '#shadow_popup',
    '#extensionsMenu',
    '#options',
    '.zoomed_avatar',
    '#bg1',
    '#bg_custom',
    '#preloader',
]);

// Слова в id/классах, по которым элемент — заведомо не лаунчер, а временная или
// оверлейная сущность. Сравниваются целыми токенами (см. tokenize), а не подстрокой:
// «modal» режет `smart-notify-modal`, но не задевает какой-нибудь `modality-btn`.
export const EXCLUDE_TOKENS = Object.freeze(new Set([
    'toast',
    'toastr',
    'tooltip',
    'tippy',
    'ghost',
    'overlay',
    'backdrop',
    'modal',
    'popup',
    'popover',
    'lightbox',
    'dialog',
    'dropdown',
    'spinner',
    'loader',
    'preloader',
    'placeholder',
]));

// ARIA-роли временных и оверлейных элементов.
export const EXCLUDE_ROLES = Object.freeze(new Set([
    'alert',
    'alertdialog',
    'status',
    'tooltip',
    'dialog',
    'log',
    'marquee',
    'timer',
    'progressbar',
    'menu',
    'listbox',
]));

// Пороги. Лаунчер — под палец или мышь: не меньше 16 px и не больше ~96 px по каждой
// стороне. Пилюля «иконка + подпись» бывает вытянутой, поэтому соотношение сторон до 3:1.
// Длинный видимый текст — признак панели или уведомления, а не кнопки.
export const LIMITS = Object.freeze({
    minSide: 16,
    maxSide: 96,
    maxAspect: 3,
    maxTextLength: 24,
    maxDepth: 2,
    minAgeMs: 1500,
});

// Разбивает id/класс на токены: `my-ext-mini-btn` → my, ext, mini, btn;
// `ext_jumpButton` → ext, jump, button.
export function tokenize(value) {
    if (typeof value !== 'string' || !value) return [];
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function hasExcludedToken(desc) {
    const names = [desc.id, ...(desc.classes ?? [])];
    for (const name of names) {
        for (const token of tokenize(name)) {
            if (EXCLUDE_TOKENS.has(token)) return token;
        }
    }
    return null;
}

// Решает, считать ли элемент плавающей кнопкой. `desc` — плоское описание:
//   tag, id, classes[], role          — идентичность
//   depth                             — 0 для прямого ребёнка body
//   position                          — computed position
//   positionedAncestor                — есть ли fixed/absolute-предок ниже body
//   visible                           — display/visibility/opacity/ненулевой размер
//   width, height                     — габариты в px
//   textLength                        — длина видимого текста (без пробелов)
//   interactive                       — нажимаем: button/a, role=button, cursor:pointer,
//                                       onclick или навешанные обработчики
//   inCore, own                       — внутри ядра ST / наш собственный элемент
//   ageMs                             — сколько элемент уже живёт в DOM по нашим часам
// Возвращает { ok: boolean, reason: string } — reason нужен диагностике в панели.
export function classifyCandidate(desc) {
    if (!desc || typeof desc !== 'object') return reject('нет описания');

    if (desc.own) return reject('свой элемент STFolder');
    if (desc.inCore) return reject('ядро SillyTavern');

    if (desc.position !== 'fixed' && !(desc.position === 'absolute' && desc.depth === 0)) {
        return reject(`position: ${desc.position}`);
    }
    if (desc.depth > LIMITS.maxDepth) return reject('слишком глубоко от body');
    if (desc.positionedAncestor) return reject('внутри другого плавающего блока');

    if (desc.role && EXCLUDE_ROLES.has(desc.role)) return reject(`role=${desc.role}`);
    const token = hasExcludedToken(desc);
    if (token) return reject(`похоже на ${token}`);

    if (!desc.visible) return reject('скрыт');

    const w = desc.width;
    const h = desc.height;
    if (!(w >= LIMITS.minSide && h >= LIMITS.minSide)) return reject(`мелкий ${fmtSize(w, h)}`);
    if (w > LIMITS.maxSide || h > LIMITS.maxSide) return reject(`крупный ${fmtSize(w, h)} — панель`);
    if (Math.max(w, h) / Math.min(w, h) > LIMITS.maxAspect) return reject(`вытянутый ${fmtSize(w, h)}`);

    if ((desc.textLength ?? 0) > LIMITS.maxTextLength) return reject('много текста — не кнопка');
    if (!desc.interactive) return reject('не похож на нажимаемый');

    if ((desc.ageMs ?? 0) < LIMITS.minAgeMs) return reject('только что появился');

    return { ok: true, reason: 'плавающая кнопка' };
}

function reject(reason) {
    return { ok: false, reason };
}

function fmtSize(w, h) {
    return `${Math.round(w)}×${Math.round(h)}`;
}

// --- Ключ кнопки ---
//
// По ключу кнопка хранится в настройках (settings.buttons[key]) и находится снова после
// перезагрузки. Поэтому он должен быть стабильным: `#id`, если id не похож на
// сгенерированный, иначе тег + «постоянные» классы (без классов состояния вроде
// `-idle`, `hidden`, `active`, которые расширение переключает на лету).

// Сгенерированный id: длинный хвост цифр, uuid/хэш, служебные префиксы фреймворков.
export function isGeneratedId(id) {
    if (typeof id !== 'string' || !id) return true;
    if (/\d{4,}/.test(id)) return true;
    if (/[0-9a-f]{8}-?[0-9a-f]{4}/i.test(id)) return true;
    if (/^(ember|react|ui-id|radix|headlessui|tippy)[-_]/i.test(id)) return true;
    return false;
}

const STATE_TOKENS = new Set([
    'active', 'inactive', 'hidden', 'visible', 'show', 'shown', 'open', 'opened', 'closed',
    'idle', 'busy', 'hover', 'focus', 'focused', 'dragging', 'dragged', 'disabled', 'enabled',
    'selected', 'collapsed', 'expanded', 'on', 'off', 'loading', 'pulse', 'animating',
    'minimized', 'maximized', 'interactable',
]);

export function isStateClass(cls) {
    if (typeof cls !== 'string' || !cls) return true;
    if (cls.startsWith('stf-')) return true;
    if (/^(fa|fa-solid|fa-regular|fa-brands)$/.test(cls)) return true;
    return tokenize(cls).some((token) => STATE_TOKENS.has(token));
}

// Экранирование идентификатора для CSS-селектора. CSS.escape в node нет, а нужен он
// только для редких символов, поэтому — простая версия для [A-Za-z0-9_-], остальное
// уходит в атрибутный селектор.
function isSimpleIdent(value) {
    return /^-?[A-Za-z_][A-Za-z0-9_-]*$/.test(value);
}

export function buttonKey(desc) {
    const id = desc?.id;
    if (id && !isGeneratedId(id)) {
        return isSimpleIdent(id) ? `#${id}` : `[id="${id.replace(/["\\]/g, '\\$&')}"]`;
    }

    const tag = (desc?.tag || 'div').toLowerCase();
    const classes = (desc?.classes ?? [])
        .filter((cls) => !isStateClass(cls) && isSimpleIdent(cls))
        .sort();
    if (classes.length === 0) return null;
    return `${tag}.${classes.join('.')}`;
}

// Подпись для списка в панели: title/aria-label, иначе ключ.
export function buttonLabel(desc, key) {
    const text = [desc?.title, desc?.ariaLabel].find((v) => typeof v === 'string' && v.trim());
    if (text) return text.trim().slice(0, 60);
    return key ?? '(без ключа)';
}
