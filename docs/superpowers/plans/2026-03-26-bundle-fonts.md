# Bundle Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle CaskaydiaCove Nerd Font Mono and JetBrains Mono Nerd Font into the Electron app so they work on any machine, and update all defaults to match the user's preferred font setup.

**Architecture:** Copy TTF font files into `packages/ui/public/fonts/`, declare `@font-face` rules in `global.css` so Vite serves them. Update default font-family strings and font sizes in `constants.ts` and `settings-store.ts`. The fonts flow through the existing build pipeline: Vite copies `public/` to `dist/`, electron-builder packages `dist/` as an extra resource.

**Tech Stack:** Electron, Vite (public dir), CSS `@font-face`, TTF fonts

---

### Task 1: Copy Font Files

**Files:**
- Create: `packages/ui/public/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf`
- Create: `packages/ui/public/fonts/CaskaydiaCoveNerdFontMono-Bold.ttf`
- Create: `packages/ui/public/fonts/CaskaydiaCoveNerdFontMono-Italic.ttf`
- Create: `packages/ui/public/fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf`
- Create: `packages/ui/public/fonts/JetBrainsMonoNerdFont-Regular.ttf`
- Create: `packages/ui/public/fonts/JetBrainsMonoNerdFont-Bold.ttf`
- Create: `packages/ui/public/fonts/JetBrainsMonoNerdFont-Italic.ttf`
- Create: `packages/ui/public/fonts/JetBrainsMonoNerdFont-BoldItalic.ttf`

- [ ] **Step 1: Create fonts directory and copy files**

```bash
mkdir -p packages/ui/public/fonts
cp /Users/kuindji/Library/Fonts/CaskaydiaCoveNerdFontMono-Regular.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/CaskaydiaCoveNerdFontMono-Bold.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/CaskaydiaCoveNerdFontMono-Italic.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/JetBrainsMonoNerdFont-Regular.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/JetBrainsMonoNerdFont-Bold.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/JetBrainsMonoNerdFont-Italic.ttf packages/ui/public/fonts/
cp /Users/kuindji/Library/Fonts/JetBrainsMonoNerdFont-BoldItalic.ttf packages/ui/public/fonts/
```

- [ ] **Step 2: Verify files are in place**

```bash
ls -lh packages/ui/public/fonts/
```

Expected: 8 TTF files, ~2.4-2.7MB each.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/public/fonts/
git commit -m "chore: bundle CaskaydiaCove and JetBrainsMono Nerd Font files"
```

---

### Task 2: Declare @font-face Rules

**Files:**
- Modify: `packages/ui/src/styles/global.css:1-3` (add @font-face before existing imports)

- [ ] **Step 1: Add @font-face declarations at the top of global.css**

Add this block **before** the existing `@import "tailwindcss";` line in `packages/ui/src/styles/global.css`:

```css
/* ── Bundled fonts ── */
@font-face {
    font-family: "CaskaydiaCove Nerd Font Mono";
    src: url("/fonts/CaskaydiaCoveNerdFontMono-Regular.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: "CaskaydiaCove Nerd Font Mono";
    src: url("/fonts/CaskaydiaCoveNerdFontMono-Bold.ttf") format("truetype");
    font-weight: 700;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: "CaskaydiaCove Nerd Font Mono";
    src: url("/fonts/CaskaydiaCoveNerdFontMono-Italic.ttf") format("truetype");
    font-weight: 400;
    font-style: italic;
    font-display: swap;
}
@font-face {
    font-family: "CaskaydiaCove Nerd Font Mono";
    src: url("/fonts/CaskaydiaCoveNerdFontMono-BoldItalic.ttf") format("truetype");
    font-weight: 700;
    font-style: italic;
    font-display: swap;
}

@font-face {
    font-family: "JetBrainsMono Nerd Font";
    src: url("/fonts/JetBrainsMonoNerdFont-Regular.ttf") format("truetype");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: "JetBrainsMono Nerd Font";
    src: url("/fonts/JetBrainsMonoNerdFont-Bold.ttf") format("truetype");
    font-weight: 700;
    font-style: normal;
    font-display: swap;
}
@font-face {
    font-family: "JetBrainsMono Nerd Font";
    src: url("/fonts/JetBrainsMonoNerdFont-Italic.ttf") format("truetype");
    font-weight: 400;
    font-style: italic;
    font-display: swap;
}
@font-face {
    font-family: "JetBrainsMono Nerd Font";
    src: url("/fonts/JetBrainsMonoNerdFont-BoldItalic.ttf") format("truetype");
    font-weight: 700;
    font-style: italic;
    font-display: swap;
}
```

- [ ] **Step 2: Update the body font-family fallback**

In the same file, change line 111:

```css
/* Before */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

/* After */
font-family: "CaskaydiaCove Nerd Font Mono", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

This ensures the bundled font is the CSS-level default even before settings load.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles/global.css
git commit -m "feat: declare @font-face rules for bundled fonts"
```

---

### Task 3: Update Default Settings

**Files:**
- Modify: `packages/shared/src/constants.ts:151-157`
- Modify: `packages/backend/src/services/settings-store.ts:18-36`

- [ ] **Step 1: Update constants.ts**

In `packages/shared/src/constants.ts`, change:

```typescript
// Before
export const DEFAULT_TERMINAL_FONT_FAMILY =
    '"CaskaydiaCove Nerd Font Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

export const DEFAULT_EDITOR_FONT_FAMILY = '"JetBrains Mono", Menlo, Monaco, monospace';
export const DEFAULT_EDITOR_FONT_SIZE = 13;

// After
export const DEFAULT_TERMINAL_FONT_FAMILY =
    '"CaskaydiaCove Nerd Font Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const DEFAULT_TERMINAL_FONT_SIZE = 18;

export const DEFAULT_EDITOR_FONT_FAMILY = '"JetBrainsMono Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace';
export const DEFAULT_EDITOR_FONT_SIZE = 18;
```

Note: Terminal font family stays the same (already correct). Editor family gets `"JetBrainsMono Nerd Font"` as the primary, keeping `"JetBrains Mono"` as fallback. Both font sizes become 18. A new `DEFAULT_TERMINAL_FONT_SIZE` constant is added.

- [ ] **Step 2: Update settings-store.ts defaults**

In `packages/backend/src/services/settings-store.ts`, update the DEFAULTS object. Add `DEFAULT_TERMINAL_FONT_SIZE` to the import and update:

```typescript
// Import line — add DEFAULT_TERMINAL_FONT_SIZE
import {
    ALL_AGENT_TYPES,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_SIZE,
    DEFAULT_TERMINAL_SHELL,
    DEFAULT_THEME_ID,
} from "@taskflow/shared";
```

Then update the DEFAULTS:

```typescript
general: {
    fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
    fontSize: 13,
    // ... rest unchanged
},
terminal: {
    fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
    fontSize: DEFAULT_TERMINAL_FONT_SIZE, // was hardcoded 13
    defaultShell: DEFAULT_TERMINAL_SHELL,
},
editor: {
    fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
    fontSize: DEFAULT_EDITOR_FONT_SIZE, // now 18
    // ... rest unchanged
},
```

- [ ] **Step 3: Check for other references to the old default font size**

Search for hardcoded `13` used as terminal/editor font size fallback anywhere in the codebase (e.g. `terminal-lifecycle.ts` line 163 has `?? 13`). Update those to use the constant.

```bash
rg "fontSize.*13|?? 13" packages/
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/backend/src/services/settings-store.ts
git commit -m "feat: update default font families and sizes to match bundled fonts"
```

---

### Task 4: Verify Build

- [ ] **Step 1: Build the UI package**

```bash
cd /Users/kuindji/Projects/taskflow && bun run build
```

Expected: Build succeeds. Fonts appear in `packages/ui/dist/fonts/`.

- [ ] **Step 2: Verify fonts are in dist**

```bash
ls -lh packages/ui/dist/fonts/
```

Expected: 8 TTF files copied from `public/fonts/`.

- [ ] **Step 3: Run the app in dev mode and verify fonts load**

```bash
cd /Users/kuindji/Projects/taskflow/electron && bun run dev
```

Open DevTools → Network tab → filter by Font. Verify CaskaydiaCove and JetBrainsMono load. Check the terminal and editor use the correct fonts.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A && git commit -m "fix: address font bundling issues from verification"
```

Only if changes were needed.
