export function buildShellPath(): string {
    const home = process.env.HOME ?? "";
    const extraPaths = [
        `${home}/.local/bin`,
        `${home}/.bun/bin`,
        `${home}/.cargo/bin`,
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
    ];
    const currentPath = process.env.PATH ?? "";
    const parts = currentPath.split(":");
    const seen = new Set(parts);
    for (const p of extraPaths) {
        if (!seen.has(p)) {
            parts.push(p);
            seen.add(p);
        }
    }
    return parts.join(":");
}
