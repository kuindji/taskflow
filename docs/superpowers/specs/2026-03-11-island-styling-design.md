# Island Panel Styling Design

## Summary

Restyle the Taskflow app so every panel is a floating "island" — rounded, bordered, separated by a dark base — with gradient-fade resize handles between them and inset rounded content areas inside the workspace. Follow default shadcn sizings and roundness. Keep the existing Catppuccin color scheme.

## Decisions

- **Island panels**: Each panel (sidebar, file explorer, workspace, task info) gets rounded corners, subtle border, and sits on a darker base color visible between panels
- **Title bar (option C)**: No visible title bar. In Electron, sidebar gets top padding for native traffic lights; task header is the window drag region. In browser, no extra padding — all islands align from the top
- **Inner content (option A)**: Terminal/editor/changes/browser content gets its own inset rounded corners with margin inside the workspace island
- **Resize handles**: Gradient transparency on edges (panel color fading to transparent), centered drag indicator pill
- **Color scheme**: Keep current Catppuccin Mocha — only add `--island-base: #11111b` (Crust)

## Files to Change

### 1. `packages/ui/src/styles/global.css`

- Add `--island-base: #11111b` to `:root`
- Add `--color-island-base: var(--island-base)` to `@theme inline` block

### 2. `packages/ui/src/components/AppShell.tsx`

**Outer container:**
- Change outer `div` from implicit `bg-background` to `bg-island-base`
- Add `p-1.5` padding to the content flex row (the `flex flex-1 overflow-hidden` div) to reveal dark base between islands

**Remove Electron title bar:**
- Delete the `isElectron && <div className="bg-card flex h-9 ...">` block entirely

**Panel divs — add island styling:**
- Sidebar: add `rounded-lg border border-border/50 overflow-hidden` plus conditional `pt-8` when `isElectron` (traffic light space)
- File explorer: add `rounded-lg border border-border/50 overflow-hidden`
- Workspace: add `rounded-lg border border-border/50 overflow-hidden`
- Task info: add `rounded-lg border border-border/50 overflow-hidden`

**Gap between islands:**
- The `p-1.5` on the content row plus resize handle width creates visual separation
- Add `gap-1.5` to the content flex row so islands without resize handles (none currently, but for consistency) still separate

### 3. `packages/ui/src/components/ResizeHandle.tsx`

**Replace current implementation:**
- Remove the centered 1px `bg-border` line
- Set minimum width to 8px (ignore `panelGap` if less than 8)
- The handle area is fully transparent (no background), letting the dark `island-base` show through naturally from the AppShell padding
- Add centered drag indicator: 2px wide, 32px tall, rounded pill, `bg-border/40` color, vertically centered
- Hover state: pill changes to `bg-border/70`
- Keep existing drag logic unchanged

### 4. `packages/ui/src/components/workspace/TabContent.tsx`

**Inset content wrapper:**

Currently TabContent returns a fragment (`<>...</>`) with tabs using `display: contents` (active) or `display: none` (inactive) for terminal state preservation.

Changes:
- Replace the fragment with a single wrapper div: `<div className="m-1.5 flex flex-1 overflow-hidden rounded-md border border-border/30">`
- Change terminal tab wrappers from `display: contents` / `display: none` to `display: flex; flex: 1` (active) / `display: none` (inactive) — `display: contents` would bypass the wrapper's `overflow-hidden` and `rounded-md` clipping
- Non-terminal tabs (editor, changes, browser) already return `null` when inactive, so they're unaffected
- The empty state ("No active tab") also renders inside the inset wrapper for visual consistency

### 5. `packages/ui/src/components/workspace/TaskHeader.tsx`

- Import and use `useIsElectron` hook
- Conditionally add `[-webkit-app-region:drag]` to the header container only when in Electron (browser doesn't need it and some browsers may interpret it unexpectedly)
- Add `[-webkit-app-region:no-drag]` to all interactive elements (buttons, badges) inside the header so they remain clickable during drag

## Non-changes

- **Color scheme**: No changes to any existing color variables
- **Component structure**: No new wrapper components — purely CSS class additions
- **Functionality**: No changes to resize logic, panel state, or any behavior
- **UI store**: `panelGap` remains but ResizeHandle enforces 8px minimum internally
- **shadcn components**: No modifications to any `ui/` components
