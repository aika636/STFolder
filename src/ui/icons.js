// Отрисовка иконки папки. Большинство иконок — глифы Font Awesome (он уже есть в ST), но
// часть рисуем своим SVG: бесплатного FA-глифа с нужной формой нет. SVG залит
// currentColor, поэтому цвет, как и у глифов, приходит из темы через --stf-*.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Четырёхлучевая «искра»: вогнутые стороны, лучи по вертикали длиннее, чем по горизонтали.
function sparkle(cx, cy, rx, ry) {
    // Чем больше k, тем полнее лучи. 0.2 — чтобы на 44 px значок не был тоньше глифов FA.
    const kx = rx * 0.2;
    const ky = ry * 0.2;
    return `M${cx} ${cy - ry}`
        + `Q${cx + kx} ${cy - ky} ${cx + rx} ${cy}`
        + `Q${cx + kx} ${cy + ky} ${cx} ${cy + ry}`
        + `Q${cx - kx} ${cy + ky} ${cx - rx} ${cy}`
        + `Q${cx - kx} ${cy - ky} ${cx} ${cy - ry}Z`;
}

// Три искры, как в эмодзи ✨: большая справа, две маленькие слева сверху и снизу.
const SVG_PATHS = Object.freeze({
    sparkles: [
        sparkle(61, 55, 27, 41),
        sparkle(24, 24, 14, 19),
        sparkle(32, 78, 12, 17),
    ].join(''),
});

// Элемент иконки: <i class="fa-solid …"> или <svg>. icon — запись из ICONS.
export function renderIcon(icon, open = false) {
    if (icon.svg && SVG_PATHS[icon.svg]) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        // Глиф FA занимает не весь em, а наш рисунок — весь; 1.25em выравнивает их на глаз.
        svg.setAttribute('width', '1.25em');
        svg.setAttribute('height', '1.25em');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'stf-svg-icon');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', SVG_PATHS[icon.svg]);
        path.setAttribute('fill', 'currentColor');
        svg.appendChild(path);
        return svg;
    }

    const i = document.createElement('i');
    i.className = `fa-solid ${open ? icon.open : icon.closed}`;
    i.setAttribute('aria-hidden', 'true');
    return i;
}
