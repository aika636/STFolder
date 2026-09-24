// Панель настроек STFolder: каркас из settings.html, общая секция с двумя
// переключателями и диагностика детектора — что найдено, что помним, что отсеяно и почему.

import { removeManual, resetSettings } from '../core/settings-core.js';
import { getCtx, toast } from '../ctx.js';
import { logError, logInfo } from '../log.js';
import { getSettings, saveSettings } from '../settings.js';
import { ICONS, SIZE_LIMITS, STYLES, clampFolderSize, findIcon } from '../core/folder-core.js';
import { getLastScan, onScan, rescanNow } from './detector.js';
import { isAutoProxied, refreshFolder, resetFolderPosition } from './folder.js';
import { flashElement } from './highlight.js';
import { startPicking } from './picker.js';
import { renderIcon } from './icons.js';

// Сколько отсеянных элементов показывать в диагностике: их бывают десятки (все скрытые
// модалки чужих расширений), но для разбора «почему не взял» хватает первых.
const MAX_REJECTED_SHOWN = 40;

export async function initSettingsUI() {
    try {
        // import.meta.url внутри src/ui/settings-ui.js резолвится относительно src/ui/,
        // поэтому путь к settings.html (лежит в корне расширения) — на два уровня выше.
        const settingsHtml = await $.get(new URL('../../settings.html', import.meta.url).href);
        $('#extensions_settings').append(settingsHtml);
    } catch (err) {
        logError('не удалось загрузить settings.html', err);
        return;
    }

    renderCommonSettings(document.getElementById('stfolder_settings_common'));
    renderLookSettings(document.getElementById('stfolder_settings_look'));

    const buttonsBox = document.getElementById('stfolder_settings_buttons');
    renderButtonsSection(buttonsBox, getLastScan());
    // Перерисовываем на каждом скане: причины отказов («только что появился», «скрыт»)
    // меняются и без смены набора найденных кнопок.
    onScan((scan) => renderButtonsSection(buttonsBox, scan));

    logInfo('панель настроек инициализирована');
}

// Отрисовывает общую секцию в готовый контейнер. Экспортируется ради тестов: собрать
// голый контейнер и проверить содержимое под jsdom можно без $.get и #extensions_settings.
export function renderCommonSettings(container) {
    if (!container) return;
    container.textContent = '';

    const settings = getSettings();

    container.appendChild(checkbox('stfolder_enabled', 'Включено', settings.enabled, (checked) => {
        settings.enabled = checked;
        saveSettings();
        refreshFolder();
    }));

    container.appendChild(checkbox(
        'stfolder_mobile_only',
        'Только на мобильном (≤ 1000 px)',
        settings.mobileOnly,
        (checked) => {
            settings.mobileOnly = checked;
            saveSettings();
            refreshFolder();
        },
    ));
}

// «Вид папки» (внутри свёрнутого inline-drawer из settings.html): плитки иконок и стилей. Превью в плитках нарисованы теми же классами,
// что и настоящая папка, поэтому показывают её в цветах текущей темы.
export function renderLookSettings(container) {
    if (!container) return;
    container.textContent = '';
    const settings = getSettings();

    const redraw = () => renderLookSettings(container);

    container.appendChild(subtitle('Иконка'));
    container.appendChild(picker('Иконка папки', ICONS, settings.icon, (icon) => preview(icon, settings.style), (id) => {
        settings.icon = id;
        saveSettings();
        refreshFolder();
        redraw();
    }));

    const currentIcon = findIcon(settings.icon);
    container.appendChild(subtitle('Стиль'));
    container.appendChild(picker('Стиль папки', STYLES, settings.style, (style) => preview(currentIcon, style.id), (id) => {
        settings.style = id;
        saveSettings();
        refreshFolder();
        redraw();
    }));

    container.appendChild(subtitle('Размер'));
    container.appendChild(sizeSlider(settings));

    const hint = document.createElement('small');
    hint.className = 'stf-settings-hint';
    hint.textContent = 'Цвета берутся из темы таверны и меняются вместе с ней. Папку можно перетаскивать пальцем или мышью. '
        + 'Долгое нажатие на папку (или плитка ✥ в ней) — режим «Упорядочить»: кнопки можно переставлять, '
        + 'вытаскивать из папки на экран и перетаскивать обратно.';
    container.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'stf-actions';
    const reset = document.createElement('div');
    reset.className = 'menu_button';
    reset.textContent = 'Вернуть папку на место';
    reset.title = 'К правому краю, по центру высоты';
    reset.addEventListener('click', () => resetFolderPosition());
    actions.appendChild(reset);
    container.appendChild(actions);
}

// Ползунок размера папки: папка меняется на лету, в настройки пишем по отпусканию.
function sizeSlider(settings) {
    const row = document.createElement('div');
    row.className = 'stf-size-row';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(SIZE_LIMITS.min);
    input.max = String(SIZE_LIMITS.max);
    input.step = String(SIZE_LIMITS.step);
    input.value = String(settings.size);
    input.setAttribute('aria-label', 'Размер папки');

    const value = document.createElement('span');
    value.className = 'stf-size-value';
    value.textContent = `${settings.size} px`;

    input.addEventListener('input', () => {
        settings.size = clampFolderSize(input.value);
        value.textContent = `${settings.size} px`;
        refreshFolder();
    });
    input.addEventListener('change', () => saveSettings());

    row.append(input, value);
    return row;
}

// Группа плиток-радиокнопок. Стрелки перемещают выбор, как у обычной radiogroup.
function picker(label, items, selectedId, renderPreview, onSelect) {
    const group = document.createElement('div');
    group.className = 'stf-picker';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', label);

    items.forEach((item, index) => {
        const tile = document.createElement('div');
        tile.className = 'stf-tile';
        tile.setAttribute('role', 'radio');
        const checked = item.id === selectedId;
        tile.setAttribute('aria-checked', String(checked));
        tile.tabIndex = checked ? 0 : -1;
        tile.title = item.label;

        const caption = document.createElement('span');
        caption.textContent = item.label;
        tile.append(renderPreview(item), caption);

        tile.addEventListener('click', () => onSelect(item.id));
        tile.addEventListener('keydown', (e) => {
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (step) {
                e.preventDefault();
                const next = items[(index + step + items.length) % items.length];
                onSelect(next.id);
                requestAnimationFrame(() => group.querySelector('[aria-checked="true"]')?.focus());
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(item.id);
            }
        });
        group.appendChild(tile);
    });
    return group;
}

function preview(icon, styleId) {
    const box = document.createElement('div');
    box.className = `stf-preview stf-style-${styleId}`;
    box.appendChild(renderIcon(icon));
    return box;
}

function subtitle(text) {
    const div = document.createElement('div');
    div.className = 'stf-subtitle';
    div.textContent = text;
    return div;
}

// Диагностика детектора. Три списка:
//   «На экране» — кандидаты текущего скана (тап по строке подсвечивает кнопку);
//   «Сейчас нет» — кнопки из настроек, которых на экране нет (контекстные, скрытые);
//   «Отсеяно» — остальные закреплённые элементы с причиной, свёрнуто.
export function renderButtonsSection(container, scan) {
    if (!container) return;

    // Не сбрасывать раскрытость «Отсеяно» при каждом перескане.
    const rejectedOpen = container.querySelector('details.stf-rejected')?.open ?? false;
    container.textContent = '';

    const header = document.createElement('div');
    header.className = 'stf-row stf-buttons-header';
    const title = document.createElement('b');
    title.textContent = `Плавающие кнопки: ${scan.found.length}`;
    const rescan = document.createElement('div');
    rescan.className = 'menu_button stf-rescan';
    rescan.title = 'Пересканировать страницу';
    rescan.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    rescan.addEventListener('click', () => rescanNow());
    header.append(title, rescan);
    container.appendChild(header);

    const hint = document.createElement('small');
    hint.className = 'stf-settings-hint';
    hint.textContent = 'Тап по строке — подсветить кнопку. Галочка «в папке» снята — кнопка остаётся на экране.';
    container.appendChild(hint);

    const actions = document.createElement('div');
    actions.className = 'stf-actions';
    actions.appendChild(actionButton('fa-hand-pointer', 'Добавить вручную',
        'Для кнопки, которую папка не нашла сама: нажмите, потом тапните по ней на экране',
        () => startPicking()));
    actions.appendChild(actionButton('fa-rotate-left', 'Сбросить всё',
        'Вернуть все настройки STFolder к исходным', () => confirmReset()));
    container.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'stf-button-list';
    if (scan.found.length === 0) {
        list.appendChild(emptyRow('Ничего не найдено'));
    }
    for (const button of scan.found) {
        const meta = button.manual ? `${sizeText(button.desc)} · вручную` : sizeText(button.desc);
        list.appendChild(buttonRow(button.label, button.key, meta, button.el, button.key));
    }
    container.appendChild(list);

    const onScreen = new Set(scan.found.map((b) => b.key));
    const absent = Object.entries(getSettings().buttons).filter(([key]) => !onScreen.has(key));
    if (absent.length) {
        const sub = document.createElement('div');
        sub.className = 'stf-subtitle';
        sub.textContent = `Сейчас нет на экране: ${absent.length}`;
        container.appendChild(sub);

        const absentList = document.createElement('div');
        absentList.className = 'stf-button-list stf-absent';
        for (const [key, entry] of absent) {
            // Если элемент есть в DOM, но отсеян, — покажем почему (обычно «скрыт»).
            const why = scan.rejected.find((r) => r.key === key)?.reason ?? 'нет в DOM';
            absentList.appendChild(buttonRow(entry.label || key, key, why, null, key));
        }
        container.appendChild(absentList);
    }

    // Невидимки без стабильного ключа (служебные узлы jQuery UI и т. п.) — шум: ни
    // подсветить, ни опознать их нельзя.
    const rejected = scan.rejected.filter((r) => r.desc.visible || r.key);

    const details = document.createElement('details');
    details.className = 'stf-rejected';
    details.open = rejectedOpen;
    const summary = document.createElement('summary');
    summary.textContent = `Отсеяно закреплённых элементов: ${rejected.length}`;
    details.appendChild(summary);
    const rejectedList = document.createElement('div');
    rejectedList.className = 'stf-button-list';
    for (const r of rejected.slice(0, MAX_REJECTED_SHOWN)) {
        rejectedList.appendChild(buttonRow(shortSelector(r.desc), '', r.reason, r.desc.visible ? r.el : null));
    }
    details.appendChild(rejectedList);
    container.appendChild(details);
}

function buttonRow(label, key, meta, el, modeKey = null) {
    const row = document.createElement('div');
    row.className = 'stf-button-row';
    if (el) {
        row.classList.add('stf-clickable');
        row.title = 'Подсветить на экране';
        row.addEventListener('click', () => flashElement(el));
    }

    const name = document.createElement('span');
    name.className = 'stf-button-name';
    name.textContent = label;
    row.appendChild(name);

    if (key && key !== label) {
        const code = document.createElement('code');
        code.className = 'stf-button-key';
        code.textContent = key;
        row.appendChild(code);
    }

    const info = document.createElement('small');
    info.className = 'stf-button-meta';
    info.textContent = meta;
    row.appendChild(info);

    if (modeKey) {
        row.appendChild(viewSelect(modeKey));
        row.appendChild(modeToggle(modeKey));
        if (getSettings().manual.includes(modeKey)) row.appendChild(removeManualButton(modeKey));
    }
    return row;
}

function actionButton(icon, text, title, onClick) {
    const button = document.createElement('div');
    button.className = 'menu_button';
    button.title = title;
    const i = document.createElement('i');
    i.className = `fa-solid ${icon}`;
    const span = document.createElement('span');
    span.textContent = ` ${text}`;
    button.append(i, span);
    button.addEventListener('click', onClick);
    return button;
}

// Крестик у кнопки, добавленной вручную: забыть её (вернётся на своё место на экране).
function removeManualButton(key) {
    const button = document.createElement('div');
    button.className = 'menu_button stf-remove-manual';
    button.title = 'Убрать из добавленных вручную';
    button.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        removeManual(getSettings(), key);
        saveSettings();
        rescanNow();
    });
    return button;
}

async function confirmReset() {
    const ctx = getCtx();
    const text = 'Сбросить все настройки STFolder? Порядок кнопок, вытащенные на экран, добавленные '
        + 'вручную, вид и место папки вернутся к исходным.';
    let ok;
    if (typeof ctx.callGenericPopup === 'function') {
        const result = await ctx.callGenericPopup(text, ctx.POPUP_TYPE?.CONFIRM ?? 2);
        ok = result === (ctx.POPUP_RESULT?.AFFIRMATIVE ?? 1);
    } else {
        ok = window.confirm(text);
    }
    if (!ok) return;

    resetSettings(getSettings());
    saveSettings();
    renderCommonSettings(document.getElementById('stfolder_settings_common'));
    renderLookSettings(document.getElementById('stfolder_settings_look'));
    refreshFolder();
    rescanNow();
    toast('success', 'Настройки STFolder сброшены.');
}

// Как показывать кнопку в папке: живьём, копией или авто (копией, если живьём не
// встала — тогда рядом пометка «авто: копия»).
function viewSelect(key) {
    const select = document.createElement('select');
    select.className = 'text_pole stf-view-select';
    select.title = 'Как показывать кнопку в папке';
    select.addEventListener('click', (e) => e.stopPropagation());
    const current = getSettings().buttons[key]?.view ?? 'auto';
    const autoLabel = isAutoProxied(key) ? 'Авто (копия)' : 'Авто';
    for (const [value, text] of [['auto', autoLabel], ['live', 'Живая'], ['proxy', 'Копия']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = value === current;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const buttons = getSettings().buttons;
        buttons[key] ??= { mode: 'folder', label: '' };
        if (select.value === 'auto') delete buttons[key].view;
        else buttons[key].view = select.value;
        saveSettings();
        refreshFolder();
    });
    return select;
}

// Галочка «в папке» у кнопки: снята — кнопка остаётся на экране как была.
function modeToggle(key) {
    const label = document.createElement('label');
    label.className = 'checkbox_label stf-mode-toggle';
    label.title = 'Прятать эту кнопку в папку';
    label.addEventListener('click', (e) => e.stopPropagation());

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = (getSettings().buttons[key]?.mode ?? 'folder') === 'folder';
    input.addEventListener('change', () => {
        const buttons = getSettings().buttons;
        buttons[key] ??= { mode: 'folder', label: '' };
        buttons[key].mode = input.checked ? 'folder' : 'screen';
        // Галочка снята — кнопка возвращается туда, где её ставит само расширение.
        delete buttons[key].pos;
        saveSettings();
        refreshFolder();
    });

    const span = document.createElement('span');
    span.textContent = 'в папке';
    label.append(input, span);
    return label;
}

function emptyRow(text) {
    const row = document.createElement('div');
    row.className = 'stf-button-row stf-empty';
    row.textContent = text;
    return row;
}

function sizeText(desc) {
    return `${Math.round(desc.width)}×${Math.round(desc.height)}`;
}

function shortSelector(desc) {
    if (desc.id) return `#${desc.id}`;
    const cls = desc.classes.slice(0, 2).join('.');
    return cls ? `${desc.tag}.${cls}` : desc.tag;
}

// Разметка чекбокса как у самой таверны (.checkbox_label — класс SillyTavern).
function checkbox(id, labelText, checked, onChange) {
    const div = document.createElement('div');
    div.className = 'stf-row';

    const label = document.createElement('label');
    label.className = 'checkbox_label';
    label.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = checked;
    input.addEventListener('change', () => onChange?.(input.checked));

    const span = document.createElement('span');
    span.textContent = labelText;

    label.append(input, span);
    div.appendChild(label);
    return div;
}
