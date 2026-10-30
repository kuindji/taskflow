export function toChromeUserAgent(ua: string): string {
    return ua.replace(/\s*(?:Electron|Taskflow)\/\S+/g, "").trim();
}
