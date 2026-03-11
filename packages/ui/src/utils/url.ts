function normalizeUrl(input: string): string {
    const trimmed = input.trim();
    if (!trimmed || trimmed === "about:blank") return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^localhost(:\d+)?/i.test(trimmed)) return `http://${trimmed}`;
    return `https://${trimmed}`;
}

export { normalizeUrl };
