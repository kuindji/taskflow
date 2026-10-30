export function isApiToken(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
