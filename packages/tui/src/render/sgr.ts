import {
    stylesEqual,
    ATTR_BOLD,
    ATTR_DIM,
    ATTR_ITALIC,
    ATTR_UNDERLINE,
    ATTR_INVERSE,
    ATTR_STRIKE,
    type Cell,
    type Color,
} from "./cells";

function colorParams(color: Color, base: 38 | 48): string[] {
    switch (color.kind) {
        case "default":
            return [];
        case "palette":
            return [String(base), "5", String(color.index)];
        case "rgb":
            return [String(base), "2", String(color.r), String(color.g), String(color.b)];
    }
}

const ATTR_CODES: Array<[number, string]> = [
    [ATTR_BOLD, "1"],
    [ATTR_DIM, "2"],
    [ATTR_ITALIC, "3"],
    [ATTR_UNDERLINE, "4"],
    [ATTR_INVERSE, "7"],
    [ATTR_STRIKE, "9"],
];

/**
 * Escape sequence that moves the terminal from `from`'s attribute state to
 * `to`'s. Always emits a full reset before setting, which keeps the encoder
 * stateless at the cost of a few bytes per changed run.
 */
function sgrDiff(from: Cell | null, to: Cell): string {
    if (from !== null && stylesEqual(from, to)) return "";

    const params = ["0"];
    for (const [bit, code] of ATTR_CODES) {
        if ((to.attrs & bit) !== 0) params.push(code);
    }
    params.push(...colorParams(to.fg, 38));
    params.push(...colorParams(to.bg, 48));
    return `\x1b[${params.join(";")}m`;
}

export { sgrDiff };
