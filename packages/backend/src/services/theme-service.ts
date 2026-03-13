import { readdir, readFile, writeFile, unlink, access } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import { bundledThemes } from "@taskflow/shared";
import type { ThemeRecord, ThemeSource, AnsiColors } from "@taskflow/shared";
import { slugify } from "../utils/slugify";

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

    constructor(themesDir: string) {
        this.themesDir = themesDir;
        this.bundledIds = new Set(bundledThemes.map((t) => t.id));
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

        const id = await this.resolveId(baseId, overwrite);

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
    ): Promise<string> {
        // If overwrite is requested and it's a user theme, reuse it
        if (overwriteExisting && !this.bundledIds.has(baseId)) {
            const exists = await this.userThemeExists(baseId);
            if (exists) return baseId;
        }

        // If no collision at all, use baseId
        if (!this.bundledIds.has(baseId)) {
            const exists = await this.userThemeExists(baseId);
            if (!exists) return baseId;
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
        try {
            await access(this.safePath(id));
            return true;
        } catch {
            return false;
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
                    results.push({ id, source: parsed });
                }
            } catch {
                // Invalid JSON — skip
            }
        }

        return results;
    }
}
