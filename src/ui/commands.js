// Точки управления папкой снаружи: пункт в wand-меню и слэш-команда /stfolder. Оба
// ведут в одни и те же действия (runFolderCommand) — на случай, если папку не видно или
// до неё неудобно дотянуться. Регистрация — через SlashCommandParser, иначе устаревший
// registerSlashCommand.

import { FOLDER_COMMANDS, parseFolderCommand } from '../core/picker-core.js';
import { getCtx, toast } from '../ctx.js';
import { logError, logInfo, warnOnce } from '../log.js';
import { rescanNow } from './detector.js';
import {
    arrangeFolder,
    closeFolder,
    folderUnavailableReason,
    openFolder,
    resetFolderPosition,
    toggleFolder,
} from './folder.js';
import { startPicking } from './picker.js';

const WAND_BUTTON_ID = 'stfolder_wand_button';

function explainUnavailable() {
    const reason = folderUnavailableReason();
    if (reason) toast('info', `Папки сейчас нет: ${reason}.`);
}

// Выполняет команду по имени из FOLDER_COMMANDS. Возвращает текст для /stfolder.
export function runFolderCommand(name) {
    switch (name) {
        case 'toggle':
            if (!toggleFolder()) explainUnavailable();
            return '';
        case 'open':
            if (!openFolder()) explainUnavailable();
            return '';
        case 'close':
            closeFolder();
            return '';
        case 'arrange':
            if (!arrangeFolder()) explainUnavailable();
            return '';
        case 'pick':
            closeFolder();
            startPicking();
            return '';
        case 'scan': {
            const scan = rescanNow();
            toast('info', `Плавающих кнопок: ${scan.found.length}.`);
            return String(scan.found.length);
        }
        case 'home':
            resetFolderPosition();
            return '';
        default:
            return '';
    }
}

// Пункт «Папка кнопок» в меню волшебной палочки: открыть/закрыть папку. ST сам
// показывает кнопку меню, когда у #extensionsMenu есть видимые дети.
export function initWandButton() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        warnOnce('no-extensions-menu', 'wand-меню не найдено — пункт «Папка кнопок» не добавлен');
        return false;
    }
    if (document.getElementById(WAND_BUTTON_ID)) return true;

    const button = document.createElement('div');
    button.id = WAND_BUTTON_ID;
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.setAttribute('tabindex', '0');
    button.setAttribute('role', 'listitem');
    button.title = 'Открыть или закрыть папку плавающих кнопок';

    const icon = document.createElement('div');
    icon.className = 'fa-fw fa-solid fa-folder-open extensionsMenuExtensionButton';

    const label = document.createElement('span');
    label.textContent = 'Папка кнопок';

    button.append(icon, label);
    button.addEventListener('click', () => {
        // Меню палочки закрывается по этому же клику — папку открываем уже после, иначе
        // её «закрытие по клику мимо» сработает на хвосте того же нажатия.
        setTimeout(() => runFolderCommand('toggle'), 0);
    });
    menu.appendChild(button);
    return true;
}

function helpString() {
    const lines = Object.entries(FOLDER_COMMANDS).map(([name, text]) => `<li><code>${name}</code> — ${text}</li>`);
    return `Папка плавающих кнопок (STFolder). Без аргумента — открыть/закрыть.<ul>${lines.join('')}</ul>`;
}

function handleSlash(value) {
    const name = parseFolderCommand(value);
    if (!name) {
        toast('warning', `Не знаю команду «${String(value).trim()}». Есть: ${Object.keys(FOLDER_COMMANDS).join(', ')}.`);
        return '';
    }
    try {
        return runFolderCommand(name);
    } catch (err) {
        logError(`/stfolder ${name} упал`, err);
        return '';
    }
}

export function initSlashCommand() {
    const ctx = getCtx();
    try {
        if (ctx.SlashCommandParser?.addCommandObject && ctx.SlashCommand?.fromProps) {
            ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
                name: 'stfolder',
                callback: (_args, value) => handleSlash(value),
                helpString: helpString(),
                unnamedArgumentList: buildArgumentList(ctx),
            }));
            logInfo('/stfolder зарегистрирована');
            return true;
        }
        if (typeof ctx.registerSlashCommand === 'function') {
            ctx.registerSlashCommand('stfolder', (_args, value) => handleSlash(value), [], helpString(), false, true);
            logInfo('/stfolder зарегистрирована (устаревший API)');
            return true;
        }
        warnOnce('no-slash-api', 'API слэш-команд не найдено — /stfolder недоступна');
        return false;
    } catch (err) {
        logError('не удалось зарегистрировать /stfolder', err);
        return false;
    }
}

// Автодополнение аргумента. Нет классов аргументов — команда живёт без подсказок.
function buildArgumentList(ctx) {
    const { SlashCommandArgument, SlashCommandEnumValue, ARGUMENT_TYPE } = ctx;
    if (!SlashCommandArgument?.fromProps) return [];
    return [
        SlashCommandArgument.fromProps({
            description: 'что сделать',
            typeList: ARGUMENT_TYPE?.STRING ? [ARGUMENT_TYPE.STRING] : [],
            isRequired: false,
            enumList: SlashCommandEnumValue
                ? Object.entries(FOLDER_COMMANDS).map(([name, text]) => new SlashCommandEnumValue(name, text))
                : [],
        }),
    ];
}
