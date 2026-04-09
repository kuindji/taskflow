const EXT_TO_LANGUAGE: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    sh: "shell",
    bash: "shell",
};

function getLanguage(path: string): string {
    const ext = path.split(".").pop() ?? "";
    return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}

export { getLanguage };
