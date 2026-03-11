# Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings modal with font family and size controls for both application and terminal, with live apply.

**Architecture:** A Radix Dialog modal rendered at `App.tsx` level, triggered by the existing Settings button in `TaskSidebar`. Font families are enumerated via `queryLocalFonts()` and presented in a searchable Popover dropdown. Changes persist immediately via the existing `SETTINGS_UPDATE` WebSocket flow. Terminal instances update live through a store subscription.

**Tech Stack:** React, Radix UI (Dialog, Popover), Zustand, xterm.js, `queryLocalFonts()` API

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/ui/src/components/ui/popover.tsx` | Create | Radix Popover primitive wrapper (like dialog.tsx) |
| `packages/ui/src/components/settings/FontFamilySelect.tsx` | Create | Searchable font family dropdown using Popover + queryLocalFonts |
| `packages/ui/src/components/settings/SettingsModal.tsx` | Create | Dialog with font sections, wired to settings store |
| `packages/ui/src/stores/ui-store.ts` | Modify | Add `settingsOpen` boolean + `toggleSettings()` |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Modify | Wire Settings button to `toggleSettings()` |
| `packages/ui/src/App.tsx` | Modify | Render `SettingsModal` at top level |
| `packages/ui/src/components/panes/TerminalPane.tsx` | Modify | Subscribe to terminal font changes, update live |

---

## Chunk 1: UI Primitives & Store

### Task 1: Add Popover UI primitive

**Files:**
- Create: `packages/ui/src/components/ui/popover.tsx`

- [ ] **Step 1: Create popover.tsx**

Standard Radix Popover wrapper following the same pattern as `dialog.tsx`:

```tsx
import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
    return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
    return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
    className,
    align = "start",
    sideOffset = 4,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
    return (
        <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
                data-slot="popover-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    "bg-popover text-popover-foreground data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border border-border p-4 shadow-md outline-hidden",
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ui/popover.tsx
git commit -m "feat: add Popover UI primitive"
```

---

### Task 2: Add settingsOpen to UI store

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts`

- [ ] **Step 1: Add settingsOpen state and toggleSettings action**

Add to the `UIStore` interface:

```typescript
settingsOpen: boolean;
toggleSettings(): void;
```

Add to the store initial state and implementation:

```typescript
settingsOpen: false,
toggleSettings() {
    set((s) => ({ settingsOpen: !s.settingsOpen }));
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add settingsOpen state to UI store"
```

---

### Task 3: Wire Settings button in TaskSidebar

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx`

- [ ] **Step 1: Import useUIStore and wire the button**

Add import:

```typescript
import { useUIStore } from "@/stores/ui-store";
```

Inside the component, get the toggle function:

```typescript
const toggleSettings = useUIStore((s) => s.toggleSettings);
```

Replace the Settings button (line 167-169) with:

```tsx
<Button
    variant="ghost"
    size="xs"
    onClick={toggleSettings}
    className="text-muted-foreground text-sm"
>
    Settings
</Button>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: wire Settings button to UI store toggle"
```

---

## Chunk 2: Settings Modal Components

### Task 4: Create FontFamilySelect component

**Files:**
- Create: `packages/ui/src/components/settings/FontFamilySelect.tsx`

This component:
- Calls `queryLocalFonts()` on first open to enumerate system fonts
- Deduplicates by family name, sorts alphabetically
- Shows a Popover with a search input + scrollable list
- Falls back to a plain text input if `queryLocalFonts()` is unavailable

- [ ] **Step 1: Create FontFamilySelect.tsx**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";

interface FontFamilySelectProps {
    value: string;
    onChange: (family: string) => void;
}

function FontFamilySelect({ value, onChange }: FontFamilySelectProps) {
    const [open, setOpen] = useState(false);
    const [fonts, setFonts] = useState<string[] | null>(null);
    const [search, setSearch] = useState("");
    const [apiAvailable, setApiAvailable] = useState(true);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || fonts !== null) return;
        if (typeof window.queryLocalFonts !== "function") {
            setApiAvailable(false);
            return;
        }
        window.queryLocalFonts().then((fontData) => {
            const families = [...new Set(fontData.map((f) => f.family))].sort(
                (a, b) => a.localeCompare(b),
            );
            setFonts(families);
        }).catch(() => {
            setApiAvailable(false);
        });
    }, [open, fonts]);

    useEffect(() => {
        if (open) {
            setSearch("");
            // Focus the search input after popover opens
            requestAnimationFrame(() => searchRef.current?.focus());
        }
    }, [open]);

    const filtered = useMemo(() => {
        if (!fonts) return [];
        if (!search) return fonts;
        const lower = search.toLowerCase();
        return fonts.filter((f) => f.toLowerCase().includes(lower));
    }, [fonts, search]);

    const handleSelect = useCallback(
        (family: string) => {
            onChange(family);
            setOpen(false);
        },
        [onChange],
    );

    // Fallback: plain text input when queryLocalFonts is not available
    if (!apiAvailable) {
        return (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 text-sm"
            />
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    className="h-8 w-full justify-between text-sm font-normal"
                >
                    <span className="truncate">{value || "Select font..."}</span>
                    <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <div className="border-border border-b p-2">
                    <Input
                        ref={searchRef}
                        placeholder="Search fonts..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-7 text-sm"
                    />
                </div>
                <div className="max-h-60 overflow-y-auto p-1">
                    {fonts === null ? (
                        <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                            Loading fonts...
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                            No fonts found
                        </div>
                    ) : (
                        filtered.map((family) => (
                            <button
                                key={family}
                                type="button"
                                className={`flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden hover:bg-accent hover:text-accent-foreground ${
                                    family === value ? "bg-accent text-accent-foreground" : ""
                                }`}
                                onClick={() => handleSelect(family)}
                            >
                                {family}
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export { FontFamilySelect };
```

- [ ] **Step 2: Add `queryLocalFonts` type declaration**

In `packages/ui/src/env.d.ts`, merge into the existing `declare global` block. The file already has a `Window` interface at line 17. Add `FontData` and `queryLocalFonts` inside the existing block:

```typescript
declare global {
    interface FontData {
        family: string;
        fullName: string;
        postscriptName: string;
        style: string;
    }

    interface WebviewElement extends HTMLElement {
        // ... existing ...
    }

    interface Window {
        taskflow?: TaskflowBridge;
        queryLocalFonts(): Promise<FontData[]>;  // add this line
    }

    // ... rest of existing declarations ...
}
```

Only add the `FontData` interface and the `queryLocalFonts` method to `Window`. Do not duplicate or replace existing declarations.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/settings/FontFamilySelect.tsx packages/ui/src/env.d.ts
git commit -m "feat: add FontFamilySelect searchable dropdown component"
```

---

### Task 5: Create SettingsModal component

**Files:**
- Create: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Create SettingsModal.tsx**

Uses the Radix Dialog wrapper. Reads current settings from `useSettingsStore`, dispatches updates on each change.

```tsx
import { useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FontFamilySelect } from "./FontFamilySelect";

function SettingsModal() {
    const open = useUIStore((s) => s.settingsOpen);
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const settings = useSettingsStore((s) => s.settings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleSettings();
        },
        [toggleSettings],
    );

    const handleGeneralFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ general: { fontFamily } });
        },
        [updateSettings],
    );

    const handleGeneralFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ general: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleTerminalFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ terminal: { fontFamily } });
        },
        [updateSettings],
    );

    const handleTerminalFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ terminal: { fontSize } });
            }
        },
        [updateSettings],
    );

    if (!settings) return null;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Changes apply immediately.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Application Font</h3>
                        <div className="grid grid-cols-[1fr_80px] gap-3 items-center">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Family</Label>
                                <FontFamilySelect
                                    value={settings.general.fontFamily}
                                    onChange={handleGeneralFontFamily}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <Input
                                    type="number"
                                    min={8}
                                    max={32}
                                    value={settings.general.fontSize}
                                    onChange={handleGeneralFontSize}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Terminal Font</h3>
                        <div className="grid grid-cols-[1fr_80px] gap-3 items-center">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Family</Label>
                                <FontFamilySelect
                                    value={settings.terminal.fontFamily}
                                    onChange={handleTerminalFontFamily}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <Input
                                    type="number"
                                    min={8}
                                    max={32}
                                    value={settings.terminal.fontSize}
                                    onChange={handleTerminalFontSize}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { SettingsModal };
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: add SettingsModal component with font controls"
```

---

## Chunk 3: Integration & Live Terminal Updates

### Task 6: Render SettingsModal in App.tsx

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Add SettingsModal to App**

Add import:

```typescript
import { SettingsModal } from "@/components/settings/SettingsModal";
```

Render `<SettingsModal />` inside the root `<div>`, alongside `<DialogHost />`:

```tsx
<div style={rootStyle} className="contents">
    <ConnectionOverlay />
    <DialogHost />
    <SettingsModal />
    <TooltipProvider>
        ...
    </TooltipProvider>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: render SettingsModal at app root level"
```

---

### Task 7: Live terminal font updates

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx`

- [ ] **Step 1: Add settings subscription effect**

Add a `useEffect` in the `TerminalPane` component that subscribes to terminal font settings and updates the cached xterm instance. Place this after the existing effects:

```typescript
// Live-update terminal font when settings change
const terminalFontFamily = useSettingsStore((s) => s.settings?.terminal?.fontFamily);
const terminalFontSize = useSettingsStore((s) => s.settings?.terminal?.fontSize);

useEffect(() => {
    const cached = terminalCache.get(sessionId);
    if (!cached || terminalFontFamily === undefined) return;
    cached.term.options.fontFamily = terminalFontFamily;
}, [sessionId, terminalFontFamily]);

useEffect(() => {
    const cached = terminalCache.get(sessionId);
    if (!cached || terminalFontSize === undefined) return;
    cached.term.options.fontSize = terminalFontSize;
    // Only fit if the terminal is currently visible
    if (visible) {
        fitTerminal(cached.fit, cached.term);
    }
}, [sessionId, terminalFontSize, visible]);
```

Note: `fontFamily` changes don't require `fit()` since xterm re-renders text in place. `fontSize` changes affect cell dimensions, so `fit()` is needed — but only when the terminal is visible (element is attached to the DOM). When a hidden terminal becomes visible, the existing visibility effect already calls `scheduleFit(true, true)`, which will pick up the new size.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: live-update terminal fonts when settings change"
```

---

### Task 8: Verify and test

- [ ] **Step 1: Build the UI package**

```bash
cd /Users/kuindji/Projects/taskflow && bun run --filter @taskflow/ui build
```

Verify no TypeScript or build errors.

- [ ] **Step 2: Manual verification checklist**

1. Click "Settings" button in sidebar → modal opens
2. Change app font family → entire UI updates immediately
3. Change app font size → entire UI updates immediately
4. Change terminal font family → all open terminals update
5. Change terminal font size → visible terminals reflow correctly
6. Close modal with X button, Escape key, and backdrop click
7. Reopen app → settings persist from previous session
8. Test in browser (non-Electron) → `queryLocalFonts()` prompts for permission or falls back to text input

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A && git commit -m "fix: address issues from settings modal testing"
```
