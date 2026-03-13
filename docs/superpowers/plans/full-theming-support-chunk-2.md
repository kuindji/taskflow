# Chunk 2: Backend — Config, Settings Store, Theme Service, Handlers

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 6: Backend Config & Settings Store Updates

**Files:**
- Modify: `packages/backend/src/config.ts:9-21`
- Modify: `packages/backend/src/services/settings-store.ts:10-57,83-108`
- Modify: `packages/backend/tests/services/settings-store.test.ts`

- [ ] **Step 1: Update config.ts**

Add `themesDir` to the config object:
```typescript
themesDir: join(CONFIG_DIR, "themes"),
```

Add to `ensureDirectories()`:
```typescript
await mkdir(config.themesDir, { recursive: true });
```

- [ ] **Step 2: Update settings-store.ts defaults and merge logic**

Follow the exact same patterns used by existing settings sections (`general`, `terminal`, `editor`, `claude`, `codex`).

Add to `DEFAULTS` (after `codex`):
```typescript
appearance: {
    theme: DEFAULT_THEME_ID,
},
```

Import `DEFAULT_THEME_ID` from `@taskflow/shared` at the top of the file.

Add to `createDefaultSettings()` (after `codex: { ...DEFAULTS.codex }`):
```typescript
appearance: { ...DEFAULTS.appearance },
```

Add to `get()` return merge (after `codex:` line, matching the existing spread pattern):
```typescript
appearance: { ...defaults.appearance, ...parsed.appearance },
```

Add to `update()` (after the `if (partial.codex)` block, matching the existing `Object.assign` pattern):
```typescript
if (partial.appearance) {
    Object.assign(current.appearance, partial.appearance);
}
```

- [ ] **Step 3: Update settings-store tests**

Add `appearance` field to all expected results in `settings-store.test.ts`:
```typescript
const DEFAULT_APPEARANCE = { theme: "catppuccin-mocha" };
```

Add to every `toEqual` block: `appearance: DEFAULT_APPEARANCE`.

Add a new test:
```typescript
it("persists appearance.theme setting", async () => {
    const result = await store.update({
        appearance: { theme: "dracula" },
    });
    expect(result.appearance.theme).toBe("dracula");
    expect((await store.get()).appearance.theme).toBe("dracula");
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/services/settings-store.ts packages/backend/tests/services/settings-store.test.ts
git commit -m "feat: add appearance settings and themes directory to config"
```

### Task 7: Theme Service

**Files:**
- Create: `packages/backend/src/services/theme-service.ts`
- Create: `packages/backend/tests/services/theme-service.test.ts`

- [ ] **Step 1: Write failing tests for ThemeService**

```typescript
// packages/backend/tests/services/theme-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ThemeService } from "../../src/services/theme-service";

describe("ThemeService", () => {
    let tempDir: string;
    let service: ThemeService;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-themes-"));
        service = new ThemeService(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("lists bundled themes", async () => {
        const themes = await service.listAll();
        expect(themes.length).toBeGreaterThanOrEqual(6);
        expect(themes.find((t) => t.id === "catppuccin-mocha" && t.source.name === "Catppuccin Mocha")).toBeTruthy();
        expect(themes.find((t) => t.id === "dracula" && t.source.name === "Dracula")).toBeTruthy();
    });

    it("lists user themes from directory", async () => {
        await writeFile(
            join(tempDir, "custom.json"),
            JSON.stringify({
                version: 1,
                name: "Custom",
                origin: "custom",
                colors: {
                    foreground: "#ffffff",
                    background: "#000000",
                    cursor: "#ffffff",
                    cursorText: "#000000",
                    selection: "#333333",
                    selectionText: "#ffffff",
                    ansi: {
                        black: "#000000", red: "#ff0000", green: "#00ff00",
                        yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                        cyan: "#00ffff", white: "#ffffff",
                        brightBlack: "#808080", brightRed: "#ff0000",
                        brightGreen: "#00ff00", brightYellow: "#ffff00",
                        brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                        brightCyan: "#00ffff", brightWhite: "#ffffff",
                    },
                },
            }),
        );

        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "custom" && t.source.name === "Custom")).toBeTruthy();
    });

    it("saves a theme to user directory", async () => {
        const theme = {
            version: 1 as const,
            name: "Saved Theme",
            origin: "imported" as const,
            colors: {
                foreground: "#ffffff",
                background: "#000000",
                cursor: "#ffffff",
                cursorText: "#000000",
                selection: "#333333",
                selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };

        await service.save(theme);
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "saved-theme" && t.source.name === "Saved Theme")).toBeTruthy();
    });

    it("skips invalid JSON files gracefully", async () => {
        await writeFile(join(tempDir, "bad.json"), "not json");
        const themes = await service.listAll();
        // Should still return bundled themes without error
        expect(themes.length).toBeGreaterThanOrEqual(6);
    });

    it("skips files with unknown version", async () => {
        await writeFile(
            join(tempDir, "future.json"),
            JSON.stringify({ version: 99, name: "Future" }),
        );
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "future")).toBeFalsy();
    });

    it("deletes a user theme", async () => {
        const theme = {
            version: 1 as const,
            name: "To Delete",
            origin: "custom" as const,
            colors: {
                foreground: "#ffffff", background: "#000000",
                cursor: "#ffffff", cursorText: "#000000",
                selection: "#333333", selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };
        await service.save(theme);
        await service.delete("to-delete");
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "to-delete")).toBeFalsy();
    });

    it("suffixes ids that would collide with bundled themes", async () => {
        const theme = {
            version: 1 as const,
            name: "Dracula",
            origin: "imported" as const,
            colors: {
                foreground: "#ffffff", background: "#000000",
                cursor: "#ffffff", cursorText: "#000000",
                selection: "#333333", selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };

        const saved = await service.save(theme);
        expect(saved.id).toBe("dracula-2");
    });

    it("reuses an explicit id only when overwriting an existing user theme", async () => {
        const theme = {
            version: 1 as const,
            name: "One Dark",
            origin: "online" as const,
            colors: {
                foreground: "#ffffff", background: "#000000",
                cursor: "#ffffff", cursorText: "#000000",
                selection: "#333333", selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };

        await service.save(theme, "one-dark");
        const updated = await service.save(
            { ...theme, name: "One Dark Updated" },
            "one-dark",
            { overwriteExisting: true },
        );

        expect(updated.id).toBe("one-dark");
        expect((await service.listAll()).find((t) => t.id === "one-dark")?.source.name).toBe(
            "One Dark Updated",
        );
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/theme-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ThemeService**

```typescript
// packages/backend/src/services/theme-service.ts
import { readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { bundledThemes } from "@taskflow/shared";
import type { ThemeRecord, ThemeSource } from "@taskflow/shared";
import { slugify } from "../utils/slugify";

function isValidThemeSource(value: unknown): value is ThemeSource {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return obj.version === 1
        && typeof obj.name === "string"
        && typeof obj.colors === "object"
        && obj.colors !== null;
}

class ThemeService {
    constructor(private themesDir: string) {}

    async listAll(): Promise<ThemeRecord[]> {
        const userThemes = await this.loadUserThemes();
        return [...bundledThemes, ...userThemes];
    }

    async save(
        theme: ThemeSource,
        preferredId?: string,
        options?: { overwriteExisting?: boolean },
    ): Promise<ThemeRecord> {
        const bundledIds = new Set(bundledThemes.map((entry) => entry.id));
        const userThemes = await this.loadUserThemes();
        const userIds = new Set(userThemes.map((entry) => entry.id));
        const baseId = preferredId ?? slugify(theme.name);
        const overwriteExisting = options?.overwriteExisting === true;

        let id = baseId;
        if (bundledIds.has(id) || (userIds.has(id) && !overwriteExisting)) {
            let suffix = 2;
            while (bundledIds.has(id) || userIds.has(id)) {
                id = `${baseId}-${suffix}`;
                suffix++;
            }
        }

        const filename = `${id}.json`;
        await writeFile(
            join(this.themesDir, filename),
            JSON.stringify(theme, null, 2),
        );
        return { id, source: theme };
    }

    async delete(id: string): Promise<void> {
        if (bundledThemes.some((theme) => theme.id === id)) {
            return;
        }
        const filename = `${id}.json`;
        await unlink(join(this.themesDir, filename)).catch(() => {});
    }

    idFor(name: string): string {
        return slugify(name);
    }

    private async loadUserThemes(): Promise<ThemeRecord[]> {
        const themes: ThemeRecord[] = [];
        let entries: string[];
        try {
            entries = await readdir(this.themesDir);
        } catch {
            return themes;
        }

        for (const entry of entries) {
            if (!entry.endsWith(".json")) continue;
            try {
                const raw = await readFile(join(this.themesDir, entry), "utf-8");
                const parsed = JSON.parse(raw);
                if (!isValidThemeSource(parsed)) continue;
                themes.push({
                    id: entry.replace(/\.json$/, ""),
                    source: parsed,
                });
            } catch {
                // Skip invalid files
            }
        }
        return themes;
    }
}
```

Export `ThemeService`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/theme-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/theme-service.ts packages/backend/tests/services/theme-service.test.ts
git commit -m "feat: add ThemeService for loading and managing themes"
```

### Task 8: Theme Handlers

**Files:**
- Create: `packages/backend/src/handlers/theme.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create theme WebSocket handlers**

```typescript
// packages/backend/src/handlers/theme.ts
import { MSG } from "@taskflow/shared";
import type {
    ThemeBrowseListResponse,
    ThemeDeletePayload,
    ThemeDownloadPayload,
    ThemeImportResponse,
    ThemeImportPayload,
    ThemeListResponse,
    ThemeSource,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { ThemeService } from "../services/theme-service";

function registerThemeHandlers(router: Router, themeService: ThemeService): void {
    router.register(MSG.THEMES_LIST, async () => {
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_IMPORT, async (payload) => {
        const { theme } = payload as ThemeImportPayload;
        const record = await themeService.save(theme);
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeImportResponse;
    });

    router.register(MSG.THEME_DELETE, async (payload) => {
        const { id } = payload as ThemeDeletePayload;
        await themeService.delete(id);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_BROWSE_LIST, async () => {
        // Curated fallback list of popular themes from terminalcolors.com.
        // Each entry has a stable id and direct Alacritty TOML download URL.
        const catalog = [
            { id: "one-dark", name: "One Dark", downloadUrl: "https://terminalcolors.com/downloads/alacritty/one-dark.toml" },
            { id: "rose-pine", name: "Rosé Pine", downloadUrl: "https://terminalcolors.com/downloads/alacritty/rose-pine.toml" },
            { id: "monokai-pro", name: "Monokai Pro", downloadUrl: "https://terminalcolors.com/downloads/alacritty/monokai-pro.toml" },
            { id: "everforest-dark", name: "Everforest Dark", downloadUrl: "https://terminalcolors.com/downloads/alacritty/everforest-dark.toml" },
            { id: "kanagawa", name: "Kanagawa", downloadUrl: "https://terminalcolors.com/downloads/alacritty/kanagawa.toml" },
            { id: "ayu-dark", name: "Ayu Dark", downloadUrl: "https://terminalcolors.com/downloads/alacritty/ayu-dark.toml" },
        ];

        // Mark which online themes are already installed locally
        const installed = await themeService.listAll();
        const installedIds = new Set(installed.map((t) => t.id));
        const themes = catalog.map((t) => ({
            ...t,
            installed: installedIds.has(t.id),
        }));

        return { themes } satisfies ThemeBrowseListResponse;
    });

    router.register(MSG.THEME_DOWNLOAD, async (payload) => {
        const { id, url, name } = payload as ThemeDownloadPayload;
        const response = await fetch(url);
        const toml = await response.text();
        // Parse Alacritty TOML into ThemeSource (using the Alacritty parser from Chunk 5)
        // For now, import parseAlacrittyToml from theme-parsers/alacritty
        const { parseAlacrittyToml } = await import("../services/theme-parsers/alacritty");
        const parsed = parseAlacrittyToml(toml, name);
        const theme: ThemeSource = { ...parsed, origin: "online" };
        await themeService.save(theme, id, { overwriteExisting: true });
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });
}
```

Export `registerThemeHandlers`.

- [ ] **Step 2: Register handlers in backend index.ts**

In `packages/backend/src/index.ts`:
- Import `registerThemeHandlers` and `ThemeService`
- Create `ThemeService` instance with `config.themesDir`
- Call `registerThemeHandlers(router, themeService)` alongside other handler registrations

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/theme.ts packages/backend/src/index.ts
git commit -m "feat: add theme WebSocket handlers and register in backend"
```
