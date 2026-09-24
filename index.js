// Точка входа STFolder. Тонкий файл: только связывает модули, вся логика — в src/.

import { getCtx, getEventTypes } from './src/ctx.js';
import { logError, logInfo } from './src/log.js';
import { rememberFoundButtons } from './src/settings.js';
import { onScan, startDetector } from './src/ui/detector.js';
import { initSlashCommand, initWandButton } from './src/ui/commands.js';
import { initFolder } from './src/ui/folder.js';
import { initSettingsUI } from './src/ui/settings-ui.js';

const VERSION = '0.6.0';

// Панель настроек появляется только после того, как ST отрисовал свой интерфейс, — это
// APP_READY. Если событие уже прошло (или его имени нет в этой версии ST), страхуемся
// отложенной попыткой, чтобы не потерять UI совсем.
function initUI() {
    let done = false;
    const run = async () => {
        if (done) return;
        done = true;

        try {
            await initSettingsUI();
        } catch (err) {
            logError('initSettingsUI упал', err);
        }

        // Детектор только наблюдает и работает и при выключенном расширении — диагностика
        // в панели нужна всегда. Прячет кнопки папка, и только когда включена.
        try {
            // На каждом скане, а не только при смене набора: после «Сбросить всё» набор
            // тот же, а записи о кнопках пусты. Пишет на диск, только если что-то новое.
            onScan((scan) => rememberFoundButtons(scan.found));
            startDetector();
        } catch (err) {
            logError('детектор не запустился', err);
        }

        try {
            initFolder();
        } catch (err) {
            logError('папка не запустилась', err);
        }

        try {
            initWandButton();
            initSlashCommand();
        } catch (err) {
            logError('wand-меню или /stfolder не подключились', err);
        }

        logInfo('ready');
    };

    try {
        const ctx = getCtx();
        const et = getEventTypes(ctx);
        if (et.APP_READY) ctx.eventSource.on(et.APP_READY, run);
    } catch (err) {
        logError('не удалось подписаться на APP_READY', err);
    }

    setTimeout(run, 3000);
}

jQuery(async () => {
    try {
        initUI();
        logInfo(`v${VERSION} загружен`);
    } catch (err) {
        logError('инициализация упала', err);
    }
});
