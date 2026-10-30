export function parseDevToolsActivePort(content: string): number | null {
    const first = content.split(/\r?\n/, 1)[0].trim();
    if (!/^\d+$/.test(first)) return null;
    const port = Number(first);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}
