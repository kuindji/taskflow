const ELLIPSIS = "\u2026";

function middleTruncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    const available = maxLen - ELLIPSIS.length;
    const frontLen = Math.ceil(available / 2);
    const backLen = Math.floor(available / 2);
    return str.slice(0, frontLen) + ELLIPSIS + str.slice(-backLen);
}

export { middleTruncate };
