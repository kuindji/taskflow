# Chunk 4: Appearance Dialog & Sidebar Button

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 16: ThemeCard Component

**Files:**
- Create: `packages/ui/src/components/appearance/ThemeCard.tsx`

- [ ] **Step 1: Create ThemeCard component**

Displays a theme preview card with:
- Color palette swatches (background, foreground, 8 ANSI colors)
- Theme name
- Origin badge (bundled/custom/imported)
- Active indicator (checkmark or highlighted border)
- Click handler to activate

```typescript
// packages/ui/src/components/appearance/ThemeCard.tsx
import { Trash2 } from "lucide-react";
import type { ThemeRecord } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface ThemeCardProps {
    theme: ThemeRecord;
    isActive: boolean;
    onClick: () => void;
    onDelete?: () => void;
}

function ThemeCard({ theme, isActive, onClick, onDelete }: ThemeCardProps) {
    const { source } = theme;
    const { colors } = source;
    const isDeletable = source.origin !== "bundled";
    const swatches = [
        colors.ansi.red,
        colors.ansi.green,
        colors.ansi.yellow,
        colors.ansi.blue,
        colors.ansi.magenta,
        colors.ansi.cyan,
    ];

    return (
        <button
            onClick={onClick}
            className={cn(
                "group relative flex flex-col rounded-lg border p-3 text-left transition-colors",
                "hover:border-accent",
                isActive ? "border-accent bg-accent/10" : "border-border",
            )}
        >
            {/* Delete button for non-bundled themes */}
            {isDeletable && onDelete && (
                <div
                    role="button"
                    tabIndex={0}
                    className="absolute top-1.5 right-1.5 hidden rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover:block"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.stopPropagation();
                            onDelete();
                        }
                    }}
                >
                    <Trash2 className="h-3 w-3" />
                </div>
            )}
            {/* Color preview */}
            <div
                className="mb-2 flex h-16 items-end gap-0.5 rounded-md p-2"
                style={{ backgroundColor: colors.background }}
            >
                <span
                    className="text-xs font-mono truncate"
                    style={{ color: colors.foreground }}
                >
                    ~/project $
                </span>
                <span
                    className="text-xs font-mono"
                    style={{ color: colors.ansi.green }}
                >
                    {" "}git status
                </span>
            </div>
            {/* Swatch row */}
            <div className="mb-2 flex gap-1">
                {swatches.map((color, i) => (
                    <div
                        key={i}
                        className="h-3 flex-1 rounded-sm"
                        style={{ backgroundColor: color }}
                    />
                ))}
            </div>
            {/* Name + badge */}
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{source.name}</span>
                {source.origin !== "bundled" && (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px]">
                        {source.origin}
                    </span>
                )}
            </div>
        </button>
    );
}
```

Export `ThemeCard`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ThemeCard.tsx
git commit -m "feat: add ThemeCard preview component"
```

### Task 17: ThemeGrid Component

**Files:**
- Create: `packages/ui/src/components/appearance/ThemeGrid.tsx`

- [ ] **Step 1: Create ThemeGrid component**

```typescript
// packages/ui/src/components/appearance/ThemeGrid.tsx
import { useState, useMemo } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeCard } from "./ThemeCard";
import { Input } from "@/components/ui/input";

function ThemeGrid() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const activateTheme = useThemeStore((s) => s.activateTheme);
    const deleteTheme = useThemeStore((s) => s.deleteTheme);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!search) return themes;
        const lower = search.toLowerCase();
        return themes.filter((t) => t.source.name.toLowerCase().includes(lower));
    }, [themes, search]);

    return (
        <div className="flex flex-col gap-3">
            <Input
                placeholder="Search themes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8"
            />
            <div className="grid grid-cols-3 gap-3">
                {filtered.map((theme) => (
                    <ThemeCard
                        key={theme.id}
                        theme={theme}
                        isActive={theme.id === activeThemeId}
                        onClick={() => void activateTheme(theme.id)}
                        onDelete={
                            theme.source.origin !== "bundled"
                                ? () => void deleteTheme(theme.id)
                                : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}
```

Export `ThemeGrid`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ThemeGrid.tsx
git commit -m "feat: add ThemeGrid component"
```

### Task 18: ImportTab Component

**Files:**
- Create: `packages/ui/src/components/appearance/ImportTab.tsx`

- [ ] **Step 1: Create ImportTab component**

This is a placeholder for now — the full parser and file-picker flow comes in Chunk 5. For now it only explains that import support is coming soon; do not add a non-functional "From File..." button yet.

```typescript
// packages/ui/src/components/appearance/ImportTab.tsx

function ImportTab() {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Import themes from your installed terminal apps.
            </p>
            <p className="text-muted-foreground text-xs">
                Coming soon: auto-detect iTerm2, Alacritty, Warp, Ghostty, Kitty, and Terminal.app themes.
            </p>
        </div>
    );
}
```

Export `ImportTab`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ImportTab.tsx
git commit -m "feat: add ImportTab placeholder component"
```

### Task 19: BrowseOnlineTab Component

**Files:**
- Create: `packages/ui/src/components/appearance/BrowseOnlineTab.tsx`

- [ ] **Step 1: Create BrowseOnlineTab component**

Placeholder for now — full terminalcolors.com integration comes in Chunk 6.

```typescript
// packages/ui/src/components/appearance/BrowseOnlineTab.tsx

function BrowseOnlineTab() {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Browse and install themes from terminalcolors.com.
            </p>
            <p className="text-muted-foreground text-xs">
                Coming soon.
            </p>
        </div>
    );
}
```

Export `BrowseOnlineTab`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/BrowseOnlineTab.tsx
git commit -m "feat: add BrowseOnlineTab placeholder component"
```

### Task 20: AppearanceDialog

**Files:**
- Create: `packages/ui/src/components/appearance/AppearanceDialog.tsx`

- [ ] **Step 1: Create AppearanceDialog**

Uses the same `Dialog` component pattern as `SettingsModal`. Three tabs: Themes, Import, Browse Online.

```typescript
// packages/ui/src/components/appearance/AppearanceDialog.tsx
import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeGrid } from "./ThemeGrid";
import { ImportTab } from "./ImportTab";
import { BrowseOnlineTab } from "./BrowseOnlineTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function AppearanceDialog() {
    const open = useUIStore((s) => s.appearanceOpen);
    const setAppearanceOpen = useUIStore((s) => s.setAppearanceOpen);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);

    useEffect(() => {
        if (open) {
            void fetchThemes();
        }
    }, [open, fetchThemes]);

    return (
        <Dialog open={open} onOpenChange={setAppearanceOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>Appearance</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="themes" className="flex-1 overflow-hidden flex flex-col">
                    <TabsList className="w-fit">
                        <TabsTrigger value="themes">Themes</TabsTrigger>
                        <TabsTrigger value="import">Import</TabsTrigger>
                        <TabsTrigger value="browse">Browse Online</TabsTrigger>
                    </TabsList>
                    <TabsContent value="themes" className="flex-1 overflow-y-auto mt-4">
                        <ThemeGrid />
                    </TabsContent>
                    <TabsContent value="import" className="flex-1 overflow-y-auto mt-4">
                        <ImportTab />
                    </TabsContent>
                    <TabsContent value="browse" className="flex-1 overflow-y-auto mt-4">
                        <BrowseOnlineTab />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
```

Export `AppearanceDialog`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/AppearanceDialog.tsx
git commit -m "feat: add AppearanceDialog with tabs"
```

### Task 21: Sidebar Button

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:218-230`

- [ ] **Step 1: Add Appearance button next to Settings**

Import `Palette` from `lucide-react` and `toggleAppearance` from `useUIStore`.

In the sidebar footer div (`<div className="flex items-center justify-end px-1.5 py-1.5">`), add the Appearance button **before** the Settings button:

```tsx
<Button
    variant="ghost"
    size="icon-xs"
    onClick={toggleAppearance}
    aria-label="Appearance"
    tooltip="Appearance"
    tooltipSide="bottom"
    className="text-muted-foreground [-webkit-app-region:no-drag]"
>
    <Palette className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: add Appearance button to sidebar footer"
```

### Task 22: Verify Full Integration

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: PASS

- [ ] **Step 2: Build and verify UI compiles**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Start the app and verify theme switching works**

Start the dev backend and UI, open the app, click the Appearance button, switch between themes, verify:
- CSS variables update (inspect `:root` in devtools)
- Terminal colors change
- Monaco editor colors change
- Theme persists after restart

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for theming system"
```
