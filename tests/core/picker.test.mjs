// Тесты ручного выбора: выбор элемента по тапу, разбор /stfolder, ручные кнопки в настройках.
// Запуск: node tests/run.mjs core

import { assert, assertEqual, report, test } from '../_harness.mjs';
import { FOLDER_COMMANDS, parseFolderCommand, pickTarget } from '../../src/core/picker-core.js';
import { DEFAULTS, addManual, getOrCreateSettings, removeManual, resetSettings } from '../../src/core/settings-core.js';

console.log('picker (core)');

const el = (position = 'static', extra = {}) => ({ position, inCore: false, own: false, ...extra });

test('тап в иконку внутри кнопки — берётся сама кнопка', () => {
    // i → div.fab (fixed) → body-ребёнок-обёртка (static)
    assertEqual(pickTarget([el(), el('fixed'), el()]).index, 1);
});

test('вложенные закреплённые — верхний (ближе к body)', () => {
    // бейдж absolute внутри fixed-кнопки
    assertEqual(pickTarget([el('absolute'), el('fixed')]).index, 1);
});

test('не плавающий, ядро, своё, пусто — отказ с причиной', () => {
    assert(pickTarget([el(), el()]).reason.includes('не плавающий'));
    assert(pickTarget([el('fixed', { inCore: true })]).reason.includes('таверны'));
    assert(pickTarget([el('fixed'), el('fixed', { own: true })]).reason.includes('папка'));
    assert(pickTarget([]).reason);
    assert(pickTarget(null).reason);
});

test('parseFolderCommand: без аргумента — toggle, алиасы, мусор', () => {
    assertEqual(parseFolderCommand(''), 'toggle');
    assertEqual(parseFolderCommand(undefined), 'toggle');
    assertEqual(parseFolderCommand('  OPEN '), 'open');
    assertEqual(parseFolderCommand('reset'), 'home');
    assertEqual(parseFolderCommand('добавить'), 'pick');
    assertEqual(parseFolderCommand('scan please'), 'scan', 'берётся первое слово');
    assertEqual(parseFolderCommand('взорвать'), null);
    assert(Object.keys(FOLDER_COMMANDS).every((name) => parseFolderCommand(name) === name));
});

test('addManual: ключ в manual, запись в папку, без дублей, pos снимается', () => {
    const s = getOrCreateSettings({ STFolder: { buttons: { '#x': { mode: 'screen', label: 'X', pos: { x: 0.1, y: 0.1 } } } } });
    assert(addManual(s, '#x', 'X'));
    assert(!addManual(s, '#x', 'X'), 'повтор — не новый');
    assertEqual(s.manual.length, 1);
    assertEqual(s.buttons['#x'].mode, 'folder');
    assert(!('pos' in s.buttons['#x']));
    assert(!addManual(s, '', 'пусто'));
});

test('removeManual: убирает ключ, запись и место в порядке', () => {
    const s = getOrCreateSettings({});
    addManual(s, 'div.my-fab', 'Моя');
    s.order = ['#a', 'div.my-fab'];
    assert(removeManual(s, 'div.my-fab'));
    assertEqual(s.manual.length, 0);
    assert(!('div.my-fab' in s.buttons));
    assertEqual(s.order.join(), '#a');
});

test('resetSettings: тот же объект, содержимое — дефолты', () => {
    const root = { STFolder: { enabled: false, icon: 'paw', manual: ['#a'], junk: 1 } };
    const s = getOrCreateSettings(root);
    const same = resetSettings(s);
    assert(same === root.STFolder, 'живой объект сохранён');
    assertEqual(s.enabled, DEFAULTS.enabled);
    assertEqual(s.icon, DEFAULTS.icon);
    assertEqual(s.manual.length, 0);
    assert(!('junk' in s));
    s.manual.push('#b');
    assertEqual(DEFAULTS.manual.length, 0, 'дефолты не задеты');
});

report('picker-core');
