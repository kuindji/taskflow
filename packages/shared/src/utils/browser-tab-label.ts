function browserTabLabel(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
    } catch {
        return url;
    }
}

export { browserTabLabel };
