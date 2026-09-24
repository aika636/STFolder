// Чистая логика: какой элемент брать по тапу в режиме ручного выбора и разбор
// аргумента /stfolder. Без DOM — тестируется под node.

// Выбор по тапу. chain — описания элементов от того, в который попал палец, вверх до
// ребёнка body включительно: [{ position, inCore, own }]. Палец обычно попадает в иконку
// внутри кнопки, а переставлять надо саму кнопку — «верхний» закреплённый предок
// (fixed/absolute ближе всех к body): так же детектор определяет единицу кнопки.
// Возвращает { index } или { reason } — почему взять нельзя.
export function pickTarget(chain) {
    if (!Array.isArray(chain) || chain.length === 0) return { reason: 'мимо' };
    if (chain.some((d) => d.own)) return { reason: 'это сама папка' };
    if (chain.some((d) => d.inCore)) return { reason: 'это часть интерфейса таверны' };

    let index = -1;
    chain.forEach((d, i) => {
        if (d.position === 'fixed' || d.position === 'absolute') index = i;
    });
    if (index === -1) return { reason: 'элемент не плавающий — его папка не спрячет' };
    return { index };
}

// /stfolder [команда]. Без аргумента — открыть/закрыть.
export const FOLDER_COMMANDS = Object.freeze({
    toggle: 'открыть или закрыть папку',
    open: 'открыть папку',
    close: 'закрыть папку',
    arrange: 'режим «Упорядочить»',
    pick: 'добавить кнопку вручную (следующий тап)',
    scan: 'пересканировать страницу',
    home: 'вернуть папку на место',
});

const ALIASES = Object.freeze({
    '': 'toggle',
    show: 'open',
    hide: 'close',
    add: 'pick',
    rescan: 'scan',
    reset: 'home',
    открыть: 'open',
    закрыть: 'close',
    добавить: 'pick',
    упорядочить: 'arrange',
});

// Возвращает имя команды или null, если такой нет.
export function parseFolderCommand(value) {
    const word = String(value ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const name = ALIASES[word] ?? word;
    return Object.hasOwn(FOLDER_COMMANDS, name) ? name : null;
}
