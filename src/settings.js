// Настройки расширения: extensionSettings.STFolder (camelCase-поле контекста ST). Вся
// логика мержа и валидации живёт в src/core/settings-core.js (без DOM, тестируется под
// node) — здесь только привязка к живому контексту SillyTavern.

import { getCtx } from './ctx.js';
import { DEFAULTS, MODULE_NAME, SETTINGS_VERSION, getOrCreateSettings, rememberButtons } from './core/settings-core.js';

export { MODULE_NAME, SETTINGS_VERSION };

// Живой (не клонированный) объект настроек — правки в нём видны сразу, сохранить их
// на диск нужно отдельным вызовом saveSettings().
export function getSettings() {
    const ctx = getCtx();
    return getOrCreateSettings(ctx.extensionSettings, MODULE_NAME, DEFAULTS);
}

export function saveSettings() {
    getCtx().saveSettingsDebounced();
}

// Запоминает найденные детектором кнопки (новые — в папку) и сохраняет, только если
// что-то поменялось: детектор сканирует часто, лишние записи на диск ни к чему.
export function rememberFoundButtons(found) {
    const settings = getSettings();
    if (rememberButtons(settings.buttons, found)) saveSettings();
}
