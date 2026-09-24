// Тесты ядра детектора. Примеры повторяют типичные плавающие кнопки расширений (круглый
// FAB, кнопка с иконкой, обёртка с бейджем, контекстная кнопка), плюс незнакомые —
// детектор не должен зависеть от конкретных имён.
// Запуск: node tests/run.mjs core

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    buttonKey,
    buttonLabel,
    classifyCandidate,
    isGeneratedId,
    isStateClass,
    tokenize,
} from '../../src/core/detector-core.js';

console.log('detector (core)');

// Типичная плавающая кнопка: прямой ребёнок body, fixed, видима, нажимаема, давно живёт.
function fab(overrides = {}) {
    return {
        tag: 'div',
        id: '',
        classes: [],
        role: '',
        depth: 0,
        position: 'fixed',
        positionedAncestor: false,
        visible: true,
        width: 42,
        height: 42,
        textLength: 0,
        interactive: true,
        inCore: false,
        own: false,
        ageMs: 10_000,
        ...overrides,
    };
}

// --- Типичные плавающие кнопки: должны браться ---

const TYPICAL_BUTTONS = [
    ['круглый лаунчер с классом', fab({ id: 'helper_button', classes: ['helper-launcher'] })],
    ['мини-кнопка', fab({ id: 'ext-mini-btn', classes: ['ext-mini-btn'] })],
    ['FAB с классом состояния', fab({ id: 'ab-fab', classes: ['ab-fab-idle'], width: 48, height: 48 })],
    ['FAB без классов', fab({ id: 'assist-fab', width: 40, height: 40 })],
    ['контекстная кнопка <button>', fab({
        tag: 'button',
        id: 'ext-jump-to-unread',
        classes: ['ext_jump_button', 'interactable'],
        width: 36,
        height: 36,
    })],
    ['мобильная мини-кнопка', fab({ id: 'events-mini-btn', width: 44, height: 44 })],
    ['обёртка с бейджем', fab({ id: 'notes_fab', depth: 0, width: 56, height: 56, textLength: 2 })],
];

for (const [name, desc] of TYPICAL_BUTTONS) {
    test(`берёт: ${name}`, () => {
        const verdict = classifyCandidate(desc);
        assert(verdict.ok, `ожидался кандидат, причина отказа: ${verdict.reason}`);
    });
}

// --- Незнакомые расширения: те же признаки, другие имена ---

test('берёт незнакомую кнопку без id и без классов, если она нажимаема', () => {
    assert(classifyCandidate(fab({ tag: 'button' })).ok);
});

test('берёт пилюлю «иконка + короткая подпись»', () => {
    assert(classifyCandidate(fab({ width: 88, height: 34, textLength: 5 })).ok);
});

test('берёт кнопку на один уровень внутри обёртки-невидимки', () => {
    assert(classifyCandidate(fab({ depth: 1 })).ok);
});

test('берёт absolute, если это прямой ребёнок body', () => {
    assert(classifyCandidate(fab({ position: 'absolute', depth: 0 })).ok);
});

// --- Отказы ---

const REJECTS = [
    ['панель 250×262', fab({ id: 'events-panel', width: 250, height: 262, textLength: 60 }), 'крупный'],
    ['скрытая панель', fab({ id: 'ext-panel', classes: ['ext-container', 'ext-hidden'], visible: false, width: 0, height: 0 }), 'скрыт'],
    ['модалка', fab({ id: 'notify-modal', width: 60, height: 60 }), 'modal'],
    ['оверлей', fab({ id: 'ab-overlay' }), 'overlay'],
    ['лайтбокс', fab({ id: 'img_lightbox', classes: ['img-lightbox'] }), 'lightbox'],
    ['тост', fab({ classes: ['toast', 'toast-info'] }), 'toast'],
    ['role=status', fab({ role: 'status' }), 'role=status'],
    ['ядро ST', fab({ id: 'send_but', inCore: true }), 'ядро'],
    ['свой элемент', fab({ classes: ['stf-folder'], own: true }), 'свой'],
    ['static', fab({ position: 'static' }), 'position'],
    ['absolute глубоко внутри', fab({ position: 'absolute', depth: 1 }), 'position'],
    ['внутри другого плавающего блока', fab({ positionedAncestor: true, depth: 1 }), 'внутри'],
    ['слишком глубоко', fab({ depth: 3 }), 'глубоко'],
    ['точка 8×8', fab({ width: 8, height: 8 }), 'мелкий'],
    ['полоса 90×20', fab({ width: 90, height: 20 }), 'вытянутый'],
    ['уведомление с текстом', fab({ width: 90, height: 60, textLength: 80 }), 'текста'],
    ['декор без обработчиков', fab({ interactive: false }), 'нажимаемый'],
    ['призрак драга', fab({ ageMs: 200 }), 'появился'],
];

for (const [name, desc, reasonPart] of REJECTS) {
    test(`отсекает: ${name}`, () => {
        const verdict = classifyCandidate(desc);
        assert(!verdict.ok, 'ожидался отказ');
        assert(verdict.reason.includes(reasonPart), `причина «${verdict.reason}» не содержит «${reasonPart}»`);
    });
}

test('не падает на пустом описании', () => {
    assertEqual(classifyCandidate(null).ok, false);
    assertEqual(classifyCandidate(undefined).ok, false);
});

// --- Токены, id и классы ---

test('tokenize режет по дефисам, подчёркиваниям и camelCase', () => {
    assertEqual(tokenize('my-ext_miniBtn').join(','), 'my,ext,mini,btn');
    assertEqual(tokenize('').length, 0);
    assertEqual(tokenize(undefined).length, 0);
});

test('исключающее слово — целым токеном, не подстрокой', () => {
    assert(classifyCandidate(fab({ id: 'modality-btn' })).ok, 'modality ≠ modal');
    assert(classifyCandidate(fab({ id: 'toaster-fab' })).ok, 'toaster ≠ toast');
    assert(!classifyCandidate(fab({ id: 'my-modal' })).ok);
});

test('isGeneratedId', () => {
    assert(isGeneratedId('el-17263541'), 'длинные цифры');
    assert(isGeneratedId('a1b2c3d4-e5f6-7890'), 'uuid');
    assert(isGeneratedId('react-select-2'), 'префикс фреймворка');
    assert(isGeneratedId(''), 'пустой');
    assert(!isGeneratedId('ab-fab'));
    assert(!isGeneratedId('helper_button'));
    assert(!isGeneratedId('btn2'), 'одна цифра — не генерация');
});

test('isStateClass', () => {
    assert(isStateClass('ab-fab-idle'));
    assert(isStateClass('ext-hidden'));
    assert(isStateClass('is-active'));
    assert(isStateClass('stf-docked'), 'наши классы');
    assert(isStateClass('fa-solid'), 'иконочные');
    assert(!isStateClass('helper-launcher'));
    assert(!isStateClass('ext-mini-btn'));
});

// --- Ключ и подпись ---

test('ключ — #id, если id стабильный', () => {
    assertEqual(buttonKey({ id: 'ab-fab', classes: ['ab-fab-idle'] }), '#ab-fab');
});

test('ключ — тег и постоянные классы, если id сгенерирован или его нет', () => {
    assertEqual(
        buttonKey({ tag: 'DIV', id: 'x-12345678', classes: ['my-fab', 'my-fab-open', 'launcher'] }),
        'div.launcher.my-fab',
    );
});

test('ключ не зависит от порядка классов и состояния', () => {
    const a = buttonKey({ tag: 'div', classes: ['b-fab', 'a-launcher', 'hidden'] });
    const b = buttonKey({ tag: 'div', classes: ['a-launcher', 'active', 'b-fab'] });
    assertEqual(a, b);
});

test('ключа нет, если опереться не на что', () => {
    assertEqual(buttonKey({ tag: 'div', classes: ['hidden'] }), null);
    assertEqual(buttonKey({ tag: 'div' }), null);
});

test('id с необычными символами — атрибутный селектор', () => {
    assertEqual(buttonKey({ id: 'fab:main' }), '[id="fab:main"]');
});

test('подпись — title, иначе aria-label, иначе ключ', () => {
    assertEqual(buttonLabel({ title: '  Телефон ' }, '#ab-fab'), 'Телефон');
    assertEqual(buttonLabel({ ariaLabel: 'Меню' }, '#x'), 'Меню');
    assertEqual(buttonLabel({}, '#assist-fab'), '#assist-fab');
});

report('detector-core');
