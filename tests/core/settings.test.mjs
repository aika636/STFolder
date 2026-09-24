// Тесты ядра настроек: создание контейнера, мердж дефолтов, починка битых
// значений. Чистый node, браузер не нужен.
// Запуск: node tests/run.mjs core

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { DEFAULTS, MODULE_NAME, getOrCreateSettings, rememberButtons } from '../../src/core/settings-core.js';

console.log('settings (core)');

test('создаёт контейнер, если его нет', () => {
    const root = {};
    const settings = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assert(Object.hasOwn(root, MODULE_NAME), 'ключ STFolder создан');
    assertEqual(settings.enabled, true, 'enabled — дефолт');
    assertEqual(settings.mobileOnly, false, 'mobileOnly — дефолт');
    assertEqual(settings.pos, null, 'pos — дефолт');
    assert(typeof settings.buttons === 'object' && settings.buttons !== null, 'buttons — объект');
    assert(Array.isArray(settings.manual), 'manual — массив');
});

test('домерживает недостающие ключи, не создавая контейнер заново', () => {
    const root = { STFolder: { enabled: false } };
    const settings = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(settings.enabled, false, 'существующее значение сохранено');
    assertEqual(settings.mobileOnly, false, 'недостающий ключ добавлен');
    assert(Array.isArray(settings.manual), 'manual добавлен');
});

test('чинит битые значения дефолтами', () => {
    const root = {
        STFolder: {
            enabled: 'да', // не boolean
            mobileOnly: 1, // не boolean
            pos: { x: 'нет', y: 5 }, // x не число
            buttons: [], // не plain object
            manual: [1, 2], // не массив строк
        },
    };
    const settings = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(settings.enabled, true, 'enabled заменён дефолтом');
    assertEqual(settings.mobileOnly, false, 'mobileOnly заменён дефолтом');
    assertEqual(settings.pos, null, 'pos заменён дефолтом');
    assert(!Array.isArray(settings.buttons), 'buttons заменён свежим объектом');
    assert(Array.isArray(settings.manual) && settings.manual.length === 0, 'manual заменён дефолтом');
});

test('сохраняет валидные значения нетронутыми', () => {
    const root = {
        STFolder: {
            enabled: false,
            mobileOnly: true,
            pos: { x: 0.12, y: 0.34 },
            buttons: { '#helper-btn': { mode: 'folder' } },
            manual: ['#custom-fab'],
        },
    };
    const settings = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(settings.enabled, false, 'enabled сохранён');
    assertEqual(settings.mobileOnly, true, 'mobileOnly сохранён');
    assertEqual(settings.pos.x, 0.12, 'pos.x сохранён');
    assertEqual(settings.pos.y, 0.34, 'pos.y сохранён');
    assertEqual(settings.buttons['#helper-btn'].mode, 'folder', 'buttons сохранён');
    assertEqual(settings.manual[0], '#custom-fab', 'manual сохранён');
});

test('возвращает живой объект — повторный вызов видит внесённые правки', () => {
    const root = {};
    const settings = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    settings.enabled = false;
    settings.manual.push('#foo');

    const again = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assert(again === settings, 'тот же объект настроек');
    assertEqual(again.enabled, false, 'правка enabled видна');
    assertEqual(again.manual[0], '#foo', 'правка manual видна');
});

test('дефолты не мутируются при починке', () => {
    const root = { STFolder: { buttons: [] } };
    getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(Object.keys(DEFAULTS.buttons).length, 0, 'DEFAULTS.buttons не тронут');
    assert(Object.isFrozen(DEFAULTS), 'DEFAULTS остаётся заморожен');
});

test('чинит записи кнопок: битый режим — дефолт, не-объект — выбрасывается', () => {
    const root = {
        STFolder: {
            buttons: {
                '#ok': { mode: 'screen', label: 'Телефон' },
                '#bad-mode': { mode: 'куда-то' },
                '#junk': 'строка',
                '#nil': null,
            },
        },
    };
    const { buttons } = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(buttons['#ok'].mode, 'screen', 'валидная запись цела');
    assertEqual(buttons['#bad-mode'].mode, 'folder', 'битый режим → folder');
    assertEqual(buttons['#bad-mode'].label, '', 'подпись добавлена');
    assert(!Object.hasOwn(buttons, '#junk'), 'строка выброшена');
    assert(!Object.hasOwn(buttons, '#nil'), 'null выброшен');
});

test('rememberButtons: новые — в папку, выбор пользователя не трогает', () => {
    const buttons = { '#ab-fab': { mode: 'screen', label: 'старое' } };
    const changed = rememberButtons(buttons, [
        { key: '#ab-fab', label: 'Телефон' },
        { key: '#assist-fab', label: '#assist-fab' },
        { key: null, label: 'без ключа' },
    ]);
    assert(changed, 'изменения есть');
    assertEqual(buttons['#ab-fab'].mode, 'screen', 'режим пользователя сохранён');
    assertEqual(buttons['#ab-fab'].label, 'Телефон', 'подпись обновлена');
    assertEqual(buttons['#assist-fab'].mode, 'folder', 'новая — в папку');
    assertEqual(Object.keys(buttons).length, 2, 'кнопка без ключа не записана');
});

test('rememberButtons: повтор того же набора — без изменений', () => {
    const buttons = {};
    rememberButtons(buttons, [{ key: '#a', label: 'A' }]);
    assertEqual(rememberButtons(buttons, [{ key: '#a', label: 'A' }]), false);
});

test('иконка и стиль: дефолты и починка неизвестных', () => {
    const fresh = getOrCreateSettings({}, MODULE_NAME, DEFAULTS);
    assertEqual(fresh.icon, 'folder');
    assertEqual(fresh.style, 'theme');

    const root = { STFolder: { icon: 'нет-такой', style: 42 } };
    const fixed = getOrCreateSettings(root, MODULE_NAME, DEFAULTS);
    assertEqual(fixed.icon, 'folder', 'неизвестная иконка → дефолт');
    assertEqual(fixed.style, 'theme', 'битый стиль → дефолт');

    const kept = getOrCreateSettings({ STFolder: { icon: 'paw', style: 'glass' } }, MODULE_NAME, DEFAULTS);
    assertEqual(kept.icon, 'paw');
    assertEqual(kept.style, 'glass');
});

test('pos вне 0..1 (старые пиксели, NaN) → сброс', () => {
    assertEqual(getOrCreateSettings({ STFolder: { pos: { x: 300, y: 0.5 } } }).pos, null);
    assertEqual(getOrCreateSettings({ STFolder: { pos: { x: NaN, y: 0.5 } } }).pos, null);
});

test('size и order: дефолты и починка', () => {
    const fresh = getOrCreateSettings({});
    assertEqual(fresh.size, 44);
    assert(Array.isArray(fresh.order) && fresh.order.length === 0);

    const fixed = getOrCreateSettings({ STFolder: { size: 500, order: 'x' } });
    assertEqual(fixed.size, 44, 'размер вне пределов → дефолт');
    assert(Array.isArray(fixed.order), 'order не массив → дефолт');

    assertEqual(getOrCreateSettings({ STFolder: { size: 60 } }).size, 60);
});

test('pos у кнопки: валидный сохраняется, битый удаляется', () => {
    const { buttons } = getOrCreateSettings({
        STFolder: {
            buttons: {
                '#a': { mode: 'screen', label: '', pos: { x: 0.2, y: 0.7 } },
                '#b': { mode: 'screen', label: '', pos: { x: 5, y: 'нет' } },
                '#c': { mode: 'screen', label: '', pos: null },
            },
        },
    });
    assertEqual(buttons['#a'].pos.x, 0.2);
    assert(!('pos' in buttons['#b']), 'битый pos удалён');
    assert(!('pos' in buttons['#c']), 'null pos удалён');
});

test('выбранная раньше палочка превращается в искры', () => {
    assertEqual(getOrCreateSettings({ STFolder: { icon: 'wand' } }).icon, 'sparkles');
});

test('lookLocked: по умолчанию выкл, не-boolean → выкл, true сохраняется', () => {
    assertEqual(getOrCreateSettings({}).lookLocked, false);
    assertEqual(getOrCreateSettings({ STFolder: { lookLocked: 'да' } }).lookLocked, false);
    assertEqual(getOrCreateSettings({ STFolder: { lookLocked: true } }).lookLocked, true);
});

report('settings-core');
