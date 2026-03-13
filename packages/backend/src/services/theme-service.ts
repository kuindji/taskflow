import { readdir, readFile, writeFile, unlink, access } from "fs/promises";
import { isAbsolute, join, relative, resolve, extname, basename } from "path";
import { bundledThemes } from "@taskflow/shared";
import type { ThemeRecord, ThemeSource, AnsiColors } from "@taskflow/shared";
import { slugify } from "../utils/slugify";
import { ONLINE_CATALOG_IDS } from "./online-theme-catalog";
import {
    detectAlacritty,
    parseAlacritty,
    parseAlacrittyToml,
    detectGhostty,
    parseGhostty,
    parseGhosttyConfig,
    detectKitty,
    parseKitty,
    parseKittyConfig,
    detectWarp,
    parseWarp,
    parseWarpYaml,
    detectIterm2,
    parseIterm2,
    parseIterm2Xml,
    detectTerminalApp,
    parseTerminalApp,
    parseTerminalAppXml,
} from "./theme-parsers";

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const THEME_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type PathApi = Pick<typeof import("path"), "resolve" | "relative" | "isAbsolute">;

const ANSI_KEYS: readonly (keyof AnsiColors)[] = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
] as const;

const VALID_ORIGINS = new Set(["bundled", "imported", "custom", "online"]);

const COLOR_FIELDS = [
    "foreground",
    "background",
    "cursor",
    "cursorText",
    "selection",
    "selectionText",
] as const;

function isValidHex(value: unknown): value is string {
    return typeof value === "string" && HEX_COLOR_RE.test(value);
}

function assertValidThemeId(id: unknown): string {
    if (typeof id !== "string" || !THEME_ID_RE.test(id)) {
        throw new Error("Invalid theme id");
    }

    return id;
}

export function isPathInsideDirectory(
    rootDir: string,
    filePath: string,
    pathApi: PathApi = { resolve, relative, isAbsolute },
): boolean {
    const relativePath = pathApi.relative(
        pathApi.resolve(rootDir),
        pathApi.resolve(filePath),
    );
    return (
        relativePath === "" ||
        (!relativePath.startsWith("..") && !pathApi.isAbsolute(relativePath))
    );
}

function isValidThemeSource(data: unknown): data is ThemeSource {
    if (typeof data !== "object" || data === null) return false;

    const obj = data as Record<string, unknown>;

    if (obj.version !== 1) return false;
    if (typeof obj.name !== "string") return false;
    if (!VALID_ORIGINS.has(obj.origin as string)) return false;

    if (typeof obj.colors !== "object" || obj.colors === null) return false;
    const colors = obj.colors as Record<string, unknown>;

    for (const field of COLOR_FIELDS) {
        if (!isValidHex(colors[field])) return false;
    }

    if (typeof colors.ansi !== "object" || colors.ansi === null) return false;
    const ansi = colors.ansi as Record<string, unknown>;

    for (const key of ANSI_KEYS) {
        if (!isValidHex(ansi[key])) return false;
    }

    if (obj.overrides !== undefined) {
        if (typeof obj.overrides !== "object" || obj.overrides === null)
            return false;
        const overrides = obj.overrides as Record<string, unknown>;
        for (const val of Object.values(overrides)) {
            if (typeof val !== "string") return false;
        }
    }

    return true;
}

export class ThemeService {
    private readonly themesDir: string;
    private readonly bundledIds: Set<string>;
    private readonly onlineCatalogIds: Set<string>;

    constructor(themesDir: string) {
        this.themesDir = themesDir;
        this.bundledIds = new Set(bundledThemes.map((t) => t.id));
        this.onlineCatalogIds = new Set(ONLINE_CATALOG_IDS);
    }

    async listAll(): Promise<ThemeRecord[]> {
        const userThemes = await this.loadUserThemes();
        return [...bundledThemes, ...userThemes];
    }

    async save(
        theme: ThemeSource,
        preferredId?: string,
        options?: { overwriteExisting?: boolean },
    ): Promise<ThemeRecord> {
        if (!isValidThemeSource(theme)) {
            throw new Error("Invalid theme source");
        }

        const baseId =
            preferredId === undefined
                ? this.idFor(theme.name)
                : assertValidThemeId(preferredId);
        const overwrite = options?.overwriteExisting ?? false;

        const id = await this.resolveId(baseId, overwrite, theme);

        const filePath = this.safePath(id);
        await writeFile(filePath, JSON.stringify(theme, null, 2));

        return { id, source: theme };
    }

    async delete(id: string): Promise<void> {
        if (this.bundledIds.has(id)) return;

        const filePath = this.safePath(id);
        try {
            await unlink(filePath);
        } catch {
            // File doesn't exist — no-op
        }
    }

    async detectTerminalApps(): Promise<Array<{ app: string; themes: ThemeSource[] }>> {
        const detectors: Array<{ app: string; detect: () => Promise<boolean>; parse: () => Promise<ThemeSource[]> }> = [
            { app: "Alacritty", detect: detectAlacritty, parse: parseAlacritty },
            { app: "Ghostty", detect: detectGhostty, parse: parseGhostty },
            { app: "Kitty", detect: detectKitty, parse: parseKitty },
            { app: "Warp", detect: detectWarp, parse: parseWarp },
            { app: "iTerm2", detect: detectIterm2, parse: parseIterm2 },
            { app: "Terminal.app", detect: detectTerminalApp, parse: parseTerminalApp },
        ];

        const results: Array<{ app: string; themes: ThemeSource[] }> = [];

        for (const { app, detect, parse } of detectors) {
            try {
                const detected = await detect();
                if (detected) {
                    const themes = await parse();
                    if (themes.length > 0) {
                        results.push({ app, themes });
                    }
                }
            } catch {
                // Skip failed detectors
            }
        }

        return results;
    }

    async importFromFile(filePath: string): Promise<ThemeRecord> {
        if (!isAbsolute(filePath)) {
            throw new Error("File path must be absolute");
        }

        const content = await readFile(filePath, "utf-8");
        const ext = extname(filePath).toLowerCase();
        const baseName = basename(filePath, ext) || "Imported Theme";

        let theme: ThemeSource | null = null;

        if (ext === ".toml") {
            theme = parseAlacrittyToml(content, baseName);
        } else if (ext === ".yaml" || ext === ".yml") {
            theme = parseWarpYaml(content, baseName);
        } else if (ext === ".json") {
            try {
                const parsed: unknown = JSON.parse(content);
                if (isValidThemeSource(parsed)) {
                    theme = {
                        ...parsed,
                        name: parsed.name || baseName,
                        origin: "imported",
                    };
                }
            } catch {
                // Invalid JSON
            }
        } else if (ext === ".plist") {
            theme = parseIterm2Xml(content, baseName);
        } else if (ext === ".terminal") {
            theme = parseTerminalAppXml(content, baseName);
        } else if (ext === ".conf" || ext === "") {
            // Try Kitty format first, then Ghostty
            theme = parseKittyConfig(content, baseName) ?? parseGhosttyConfig(content, baseName);
        }

        if (!theme) {
            // Try all parsers as fallback
            theme =
                parseAlacrittyToml(content, baseName) ??
                parseWarpYaml(content, baseName) ??
                parseKittyConfig(content, baseName) ??
                parseGhosttyConfig(content, baseName) ??
                parseIterm2Xml(content, baseName);
        }

        if (!theme) {
            throw new Error("Could not parse theme file. Unsupported format.");
        }

        return this.save(theme);
    }

    idFor(name: string): string {
        return slugify(name) || "theme";
    }

    private safePath(id: string): string {
        const normalizedId = assertValidThemeId(id);
        const themesRoot = resolve(this.themesDir);
        const filePath = resolve(themesRoot, `${normalizedId}.json`);

        if (!isPathInsideDirectory(themesRoot, filePath)) {
            throw new Error("Invalid theme id");
        }

        return filePath;
    }

    private async resolveId(
        baseId: string,
        overwriteExisting: boolean,
        theme: ThemeSource,
    ): Promise<string> {
        const isReservedOnlineId = this.onlineCatalogIds.has(baseId);
        const existingFile = await this.readUserThemeFile(baseId);

        // If overwrite is requested and it's a user theme, reuse it
        if (overwriteExisting && !this.bundledIds.has(baseId)) {
            if (
                !isReservedOnlineId &&
                existingFile.exists
            ) {
                return baseId;
            }

            if (
                isReservedOnlineId &&
                theme.origin === "online" &&
                existingFile.source?.origin === "online"
            ) {
                return baseId;
            }
        }

        // If no collision at all, use baseId
        if (!this.bundledIds.has(baseId)) {
            if (!existingFile.exists && (!isReservedOnlineId || theme.origin === "online")) {
                return baseId;
            }
        }

        // Find a suffix
        for (let counter = 2; counter < 1000; counter++) {
            const candidate = `${baseId}-${counter}`;
            if (
                !this.bundledIds.has(candidate) &&
                !(await this.userThemeExists(candidate))
            ) {
                return candidate;
            }
        }
        throw new Error(`Could not resolve a unique id for "${baseId}"`);
    }

    private async userThemeExists(id: string): Promise<boolean> {
        return (await this.readUserThemeFile(id)).exists;
    }

    private async readUserThemeFile(
        id: string,
    ): Promise<{ exists: boolean; source?: ThemeSource }> {
        const filePath = this.safePath(id);

        try {
            const raw = await readFile(filePath, "utf-8");
            const parsed: unknown = JSON.parse(raw);

            return isValidThemeSource(parsed)
                ? { exists: true, source: parsed }
                : { exists: true };
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return { exists: false };
            }

            try {
                await access(filePath);
                return { exists: true };
            } catch {
                return { exists: false };
            }
        }
    }

    private async loadUserThemes(): Promise<ThemeRecord[]> {
        let files: string[];
        try {
            files = await readdir(this.themesDir);
        } catch {
            return [];
        }

        const results: ThemeRecord[] = [];

        for (const file of files) {
            if (!file.endsWith(".json")) continue;

            const id = file.slice(0, -5); // strip .json
            if (this.bundledIds.has(id)) continue;

            try {
                const raw = await readFile(join(this.themesDir, file), "utf-8");
                const parsed: unknown = JSON.parse(raw);

                if (isValidThemeSource(parsed)) {
                    if (this.onlineCatalogIds.has(id) && parsed.origin !== "online") {
                        continue;
                    }
                    results.push({ id, source: parsed });
                }
            } catch {
                // Invalid JSON — skip
            }
        }

        return results;
    }
}
