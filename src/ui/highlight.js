// Подсветка чужого элемента по тапу в панели диагностики: рамка поверх его прямоугольника
// на полторы секунды. Сам элемент не трогаем — рамка отдельным узлом в body.

const FLASH_MS = 1500;
let current = null;

export function flashElement(el) {
    current?.remove();
    current = null;
    if (!el?.isConnected) return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const frame = document.createElement('div');
    frame.className = 'stf-highlight';
    frame.setAttribute('data-stf-own', '');
    frame.style.left = `${rect.left - 4}px`;
    frame.style.top = `${rect.top - 4}px`;
    frame.style.width = `${rect.width + 8}px`;
    frame.style.height = `${rect.height + 8}px`;
    document.body.appendChild(frame);
    current = frame;

    setTimeout(() => {
        frame.remove();
        if (current === frame) current = null;
    }, FLASH_MS);
    return true;
}
