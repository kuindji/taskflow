export function isApiToken(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export interface PortHandshake {
    port: number;
    token: string;
}

export function parsePortHandshake(content: string): PortHandshake | null {
    const lines = content.split("\n");
    if (lines.length !== 2 && !(lines.length === 3 && lines[2] === "")) return null;
    if (!/^\d+$/.test(lines[0]) || !isApiToken(lines[1])) return null;
    const port = Number(lines[0]);
    return port >= 1 && port <= 65535 ? { port, token: lines[1] } : null;
}
