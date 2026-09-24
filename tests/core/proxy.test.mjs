// Тесты ядра прокси-режима. Запуск: node tests/run.mjs core

import { assert, assertEqual, report, test } from '../_harness.mjs';
import {
    COPY_CHILD_EXTRA_PROPS,
    COPY_STYLE_PROPS,
    placementFailed,
    tapSequence,
    useProxy,
    viewOf,
} from '../../src/core/proxy-core.js';
import { getOrCreateSettings } from '../../src/core/settings-core.js';

console.log('proxy (core)');

test('viewOf: неизвестное и отсутствующее → auto', () => {
    assertEqual(viewOf({ view: 'proxy' }), 'proxy');
    assertEqual(viewOf({ view: 'куда' }), 'auto');
    assertEqual(viewOf({}), 'auto');
    assertEqual(viewOf(undefined), 'auto');
});

test('useProxy: auto — только если живое размещение провалилось', () => {
    const failed = new Set(['#bad']);
    assert(!useProxy({}, '#ok', failed));
    assert(useProxy({}, '#bad', failed));
    assert(useProxy({ view: 'proxy' }, '#ok', failed), 'proxy — всегда');
    assert(!useProxy({ view: 'live' }, '#bad', failed), 'live — никогда');
});

test('placementFailed: допуск и нулевой размер', () => {
    const at = { left: 100, top: 50 };
    assert(!placementFailed(at, { left: 101.5, top: 49, width: 40, height: 40 }), 'субпиксели — ок');
    assert(placementFailed(at, { left: 300, top: 50, width: 40, height: 40 }), 'не на месте');
    assert(placementFailed(at, { left: 100, top: 50, width: 0, height: 0 }), 'не показалась');
    assert(placementFailed(at, null));
});

test('tapSequence: по умолчанию мышь, тач — только если мыши не видно', () => {
    assertEqual(tapSequence().join(' '), 'pointerdown mousedown pointerup mouseup click');
    assertEqual(tapSequence({ hasTouch: true }).join(' '), 'pointerdown touchstart pointerup touchend click');
    assertEqual(tapSequence({ hasTouch: true, hasMouse: true }).includes('touchstart'), false, 'не оба сразу');
    assertEqual(tapSequence({ hasTouch: true, touchSupported: false }).includes('touchstart'), false, 'нет TouchEvent — мышь');
});

test('tapSequence: click — последним, pointer — раньше совместимых', () => {
    for (const seq of [tapSequence(), tapSequence({ hasTouch: true })]) {
        assertEqual(seq[seq.length - 1], 'click');
        assert(seq.indexOf('pointerdown') < seq.indexOf('pointerup'));
        assertEqual(seq.filter((t) => /mouse|touch/.test(t)).length, 2);
    }
});

test('копия не тащит геометрию позиционирования корня', () => {
    for (const prop of ['position', 'left', 'top', 'transform', 'margin-left', 'inset']) {
        assert(!COPY_STYLE_PROPS.includes(prop), prop);
    }
    assert(COPY_CHILD_EXTRA_PROPS.includes('position'), 'у потомков (бейдж) — переносим');
});

test('настройки: view валидный сохраняется, битый выбрасывается', () => {
    const { buttons } = getOrCreateSettings({
        STFolder: {
            buttons: {
                '#a': { mode: 'folder', label: '', view: 'proxy' },
                '#b': { mode: 'folder', label: '', view: 'как-нибудь' },
            },
        },
    });
    assertEqual(buttons['#a'].view, 'proxy');
    assert(!('view' in buttons['#b']));
});

report('proxy-core');
