# Chunk 3: UI Integration — Theme Store, useTheme Hook, Monaco Setup, Terminal/Editor Updates

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 9: UI Store Updates

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts:14-55`

- [ ] **Step 1: Add appearanceOpen state to UIStore**

Add to the interface:
```typescript
appearanceOpen: boolean;
setAppearanceOpen(open: boolean): void;
toggleAppearance(): void;
```

Add to the store:
```typescript
appearanceOpen: false,
setAppearanceOpen(open) {
    set({ appearanceOpen: open });
},
toggleAppearance() {
    set((s) => ({ appearanceOpen: !s.appearanceOpen }));
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add appearance dialog state to UI store"
```

### Task 10: Theme Store

**Files:**
- Create: `packages/ui/src/stores/theme-store.ts`

- [ ] **Step 1: Create theme store**

```typescript
// packages/ui/src/stores/theme-store.ts
import { create } from "zustand";
import { MSG, DEFAULT_THEME_ID, bundledThemes, deriveTheme } from "@taskflow/shared";
import type {
    OnlineThemeRecord,
    ResolvedTheme,
    ThemeDownloadResponse,
    ThemeImportResponse,
    ThemeListResponse,
    ThemeRecord,
    ThemeSource,
} from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useSettingsStore } from "./settings-store";

// Eagerly resolve the default bundled theme so `resolved` is never null.
// This ensures terminals and Monaco have a valid theme before settings load.
const defaultRecord = bundledThemes.find((t) => t.id === DEFAULT_THEME_ID) ?? bundledThemes[0];
const defaultResolved = deriveTheme(defaultRecord.source);

interface ThemeStore {
    themes: ThemeRecord[];
    activeThemeId: string;
    resolved: ResolvedTheme;
    fetchThemes(): Promise<void>;
    activateTheme(themeId: string): Promise<void>;
    importTheme(theme: ThemeSource): Promise<void>;
    importThemeFile(path: string): Promise<void>;
    downloadOnlineTheme(theme: OnlineThemeRecord): Promise<void>;
    deleteTheme(themeId: string): Promise<void>;
}

// Helper: given a response with themes + importedThemeId, update store and persist setting.
function applyImportResponse(
    set: (state: Partial<ThemeStore>) => void,
    response: { themes: ThemeRecord[]; importedThemeId: string },
): void {
    const record = response.themes.find((t) => t.id === response.importedThemeId);
    set(
        record
            ? {
                  themes: response.themes,
                  activeThemeId: record.id,
                  resolved: deriveTheme(record.source),
              }
            : { themes: response.themes },
    );
    if (record) {
        void useSettingsStore.getState().updateSettings({
            appearance: { theme: record.id },
        });
    }
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
    themes: bundledThemes,
    activeThemeId: defaultRecord.id,
    resolved: defaultResolved,

    async fetchThemes() {
        try {
            const { themes } = await sendRequest<ThemeListResponse>(MSG.THEMES_LIST);

            // Resolve the active theme using the persisted canonical id.
            const activeThemeId =
                useSettingsStore.getState().settings?.appearance?.theme ?? DEFAULT_THEME_ID;
            const record = themes.find((t) => t.id === activeThemeId)
                ?? themes.find((t) => t.id === DEFAULT_THEME_ID)
                ?? themes[0];
            if (record) {
                set({
                    themes,
                    activeThemeId: record.id,
                    resolved: deriveTheme(record.source),
                });
            } else {
                set({ themes });
            }
        } catch {
            // Keep the eagerly resolved bundled default so startup and reconnects remain usable.
        }
    },

    async activateTheme(themeId: string) {
        const record = get().themes.find((t) => t.id === themeId);
        if (!record) return;
        set({
            activeThemeId: record.id,
            resolved: deriveTheme(record.source),
        });
        await useSettingsStore.getState().updateSettings({
            appearance: { theme: themeId },
        });
    },

    async importTheme(theme: ThemeSource) {
        const response = await sendRequest<ThemeImportResponse>(
            MSG.THEME_IMPORT,
            { theme },
        );
        applyImportResponse(set, response);
    },

    async importThemeFile(path: string) {
        const response = await sendRequest<ThemeImportResponse>(
            MSG.THEME_IMPORT_FILE,
            { path },
        );
        applyImportResponse(set, response);
    },

    async downloadOnlineTheme(theme) {
        const response = await sendRequest<ThemeDownloadResponse>(
            MSG.THEME_DOWNLOAD,
            { id: theme.id, url: theme.downloadUrl, name: theme.name },
        );
        applyImportResponse(set, response);
    },

    async deleteTheme(themeId: string) {
        const deletingActive = themeId === get().activeThemeId;
        const { themes } = await sendRequest<ThemeListResponse>(MSG.THEME_DELETE, { id: themeId });
        const fallbackId = deletingActive ? DEFAULT_THEME_ID : get().activeThemeId;
        const record = themes.find((t) => t.id === fallbackId) ?? themes[0];

        if (record) {
            set({
                themes,
                activeThemeId: record.id,
                resolved: deriveTheme(record.source),
            });
        } else {
            set({ themes });
        }

        if (deletingActive && record) {
            await useSettingsStore.getState().updateSettings({
                appearance: { theme: record.id },
            });
        }
    },
}));
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/theme-store.ts
git commit -m "feat: add Zustand theme store"
```

### Task 11: Monaco Theme Setup

**Files:**
- Create: `packages/ui/src/lib/monaco-theme.ts`

- [ ] **Step 1: Create module-level Monaco theme registration**

```typescript
// packages/ui/src/lib/monaco-theme.ts
import * as monaco from "monaco-editor";
import type { ResolvedTheme } from "@taskflow/shared";

const THEME_NAME = "taskflow";

// Default theme registered at module load time (Catppuccin Mocha fallback).
// This ensures "taskflow" exists before any EditorPane mounts.
monaco.editor.defineTheme(THEME_NAME, {
    base: "vs-dark",
    inherit: true,
    rules: [
        { token: "", foreground: "cdd6f4", background: "1e1e2e" },
        { token: "comment", foreground: "585b70", fontStyle: "italic" },
        { token: "keyword", foreground: "89b4fa" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "f9e2af" },
        { token: "type", foreground: "cba6f7" },
        { token: "function", foreground: "89b4fa" },
        { token: "variable", foreground: "cdd6f4" },
        { token: "constant", foreground: "f38ba8" },
        { token: "operator", foreground: "94e2d5" },
        { token: "delimiter", foreground: "585b70" },
    ],
    colors: {
        "editor.background": "#1e1e2e",
        "editor.foreground": "#cdd6f4",
        "editor.selectionBackground": "#31324480",
        "editor.lineHighlightBackground": "#181825",
        "editorCursor.foreground": "#f5e0dc",
        "editorWhitespace.foreground": "#31324440",
        "editorIndentGuide.background": "#31324440",
        "editorLineNumber.foreground": "#585b70",
        "editorLineNumber.activeForeground": "#cdd6f4",
    },
});

function updateMonacoTheme(resolved: ResolvedTheme): void {
    const { css, xterm } = resolved;
    const fg = css["--foreground"].replace("#", "");
    const bg = css["--background"];
    const comment = css["--muted-foreground"].replace("#", "");
    const keyword = css["--accent"].replace("#", "");
    const string = xterm.green.replace("#", "");
    const number = xterm.yellow.replace("#", "");
    const type = xterm.magenta.replace("#", "");
    const constant = xterm.red.replace("#", "");
    const operator = xterm.cyan.replace("#", "");

    monaco.editor.defineTheme(THEME_NAME, {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "", foreground: fg, background: bg.replace("#", "") },
            { token: "comment", foreground: comment, fontStyle: "italic" },
            { token: "keyword", foreground: keyword },
            { token: "string", foreground: string },
            { token: "number", foreground: number },
            { token: "type", foreground: type },
            { token: "function", foreground: keyword },
            { token: "variable", foreground: fg },
            { token: "constant", foreground: constant },
            { token: "operator", foreground: operator },
            { token: "delimiter", foreground: comment },
        ],
        colors: {
            "editor.background": bg,
            "editor.foreground": css["--foreground"],
            "editor.selectionBackground": css["--secondary"] + "80",
            "editor.lineHighlightBackground": css["--card"],
            "editorCursor.foreground": resolved.xterm.cursor,
            "editorWhitespace.foreground": css["--secondary"] + "40",
            "editorIndentGuide.background": css["--secondary"] + "40",
            "editorLineNumber.foreground": css["--muted-foreground"],
            "editorLineNumber.activeForeground": css["--foreground"],
        },
    });

    monaco.editor.setTheme(THEME_NAME);
}

const MONACO_THEME_NAME = THEME_NAME;
```

Export `updateMonacoTheme` and `MONACO_THEME_NAME`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/lib/monaco-theme.ts
git commit -m "feat: add module-level Monaco theme registration"
```

### Task 12: useTheme Hook

**Files:**
- Create: `packages/ui/src/hooks/useTheme.ts`

- [ ] **Step 1: Create useTheme hook**

```typescript
// packages/ui/src/hooks/useTheme.ts
import { useEffect } from "react";
import { useThemeStore } from "../stores/theme-store";
import { updateMonacoTheme } from "../lib/monaco-theme";

function useTheme(): void {
    // resolved is never null — theme store eagerly resolves the default theme
    const resolved = useThemeStore((s) => s.resolved);

    useEffect(() => {
        // Apply CSS variables to document root
        const root = document.documentElement;
        for (const [key, value] of Object.entries(resolved.css)) {
            root.style.setProperty(key, value);
        }

        // Update Monaco theme
        updateMonacoTheme(resolved);
    }, [resolved]);
}
```

Export `useTheme`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/useTheme.ts
git commit -m "feat: add useTheme hook for applying theme to DOM and Monaco"
```

### Task 13: TerminalPane Integration

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:376-426`

- [ ] **Step 1: Rewrite getTerminalTheme**

**Delete** the `getCssVar` helper function entirely (lines 376-378) — it is no longer needed.

**Delete** the existing `getTerminalTheme` function (lines 380-404) and all hardcoded Catppuccin hex values.

Import `useThemeStore` at the top of the file:
```typescript
import { useThemeStore } from "@/stores/theme-store";
```

Replace with a simple store read. Since the theme store eagerly resolves the default theme at module init time, `resolved` is always available — no fallback needed:

```typescript
function getTerminalTheme(): Record<string, string> {
    return { ...useThemeStore.getState().resolved.xterm };
}
```

- [ ] **Step 2: Add theme change subscription**

Inside the `TerminalPane` component, add an effect that re-themes all cached terminals when the resolved theme changes:

```typescript
const resolved = useThemeStore((s) => s.resolved);

useEffect(() => {
    if (!resolved) return;
    // Re-theme all cached terminals
    for (const [, cached] of terminalCache) {
        cached.term.options.theme = { ...resolved.xterm };
    }
}, [resolved]);
```

Note: the `terminalCache` is module-level so it's accessible. Adjust based on how it's exported/accessible within the file.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: integrate theme store into TerminalPane"
```

### Task 14: EditorPane Integration

**Files:**
- Modify: `packages/ui/src/components/panes/EditorPane.tsx:1,92`

- [ ] **Step 1: Replace vs-dark with taskflow theme**

Add import at top:
```typescript
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
```

Change line 92:
```typescript
// Before:
theme: "vs-dark",
// After:
theme: MONACO_THEME_NAME,
```

That's it — the `useTheme` hook handles re-theming globally via `monaco.editor.setTheme()`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/EditorPane.tsx
git commit -m "feat: use dynamic Monaco theme in EditorPane"
```

### Task 15: App.tsx Integration

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Wire useTheme and theme fetch into App**

Add imports:
```typescript
import { useTheme } from "@/hooks/useTheme";
import "@/lib/monaco-theme"; // Ensure module-level defineTheme runs
```

Inside the `App` component:
```typescript
export function App() {
    useTheme();
    // ... existing code ...
}
```

Theme fetch is triggered at startup, but it must not block project/task loading. Fetch projects/tasks independently, then load settings/themes in a separate best-effort branch so a settings/theme failure cannot leave the sidebar empty. In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, update the `useEffect` at line 39-44:

```typescript
useEffect(() => {
    if (!connected) return;
    void fetchProjects();
    void fetchTasks();

    void (async () => {
        try {
            await fetchSettings();
        } catch {
            // Keep existing defaults if settings are temporarily unavailable.
        }

        try {
            await fetchThemes();
        } catch {
            // Theme store already has a bundled fallback; keep the app usable.
        }
    })();
}, [connected, fetchProjects, fetchTasks, fetchSettings, fetchThemes]);
```

Add `fetchThemes` from `useThemeStore` to the destructured selectors at the top of the component:
```typescript
const fetchThemes = useThemeStore((s) => s.fetchThemes);
```

- [ ] **Step 2: Add AppearanceDialog to App**

Add import:
```typescript
import { AppearanceDialog } from "@/components/appearance/AppearanceDialog";
```

Add `<AppearanceDialog />` alongside `<SettingsModal />` in the JSX.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: wire useTheme hook and AppearanceDialog into App"
```
