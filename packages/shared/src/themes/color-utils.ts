interface RGB {
    r: number;
    g: number;
    b: number;
}

function parseHex(hex: string): RGB {
    const h = hex.replace("#", "");
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16),
        };
    }
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

function toHex(n: number): string {
    return Math.round(Math.min(255, Math.max(0, n)))
        .toString(16)
        .padStart(2, "0");
}

export function lighten(hex: string, amount: number): string {
    const { r, g, b } = parseHex(hex);
    return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
}

export function hexToRgba(hex: string, alpha: number): string {
    const { r, g, b } = parseHex(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
