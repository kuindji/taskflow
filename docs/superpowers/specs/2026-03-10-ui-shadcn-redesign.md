# UI Redesign: shadcn/ui Primitives + cva/cn Component Architecture

> Revises Chunks 5 & 6 of the [Taskflow Implementation Plan](../plans/taskflow-plan.md) and adds a new Chunk 4.5.

## Problem

The original Chunks 5 & 6 use raw HTML elements (`<button>`, `<input>`, `<select>`) and extensive inline `style={{}}` objects in Chunk 6. This makes styling inconsistent, hard to customize globally, and produces components that aren't reusable.

## Solution

1. **Add Chunk 4.5** — Initialize shadcn/ui in `packages/ui/`, map the Catppuccin Mocha theme to shadcn's CSS variable convention, and pull 13 primitive components.
2. **Revise Chunk 5** — All app components compose shadcn primitives instead of raw elements.
3. **Revise Chunk 6** — All inline styles replaced with Tailwind utility classes. All interactive elements use shadcn primitives.

## Decisions

- **shadcn/ui with New York style** — slightly more compact, fits a dense desktop app.
- **Adopt shadcn's CSS variable convention** — replace the Chunk 1 `@theme` custom tokens (`--color-base`, `--color-surface`, etc.) with shadcn's standard names (`--background`, `--card`, `--muted`, etc.) using the same Catppuccin Mocha color values.
- **Tailwind CSS v4** — uses `@theme` inline in `global.css`, no `tailwind.config.js`.
- **cva pattern** — app-specific components (TaskCard, TabBar tab, FileTree node, diff lines) define their own `cva()` variants and accept a `className` prop merged via `cn()`.
- **Inline style exceptions** — only for truly dynamic values: FileTree depth indentation, AppShell sidebar drag-resize width, xterm.js Terminal constructor theme.

## Theme Mapping

| shadcn Variable | Catppuccin Value | Original Token |
|---|---|---|
| `--background` | `#1e1e2e` | base |
| `--foreground` | `#cdd6f4` | primary |
| `--card` | `#181825` | surface |
| `--card-foreground` | `#cdd6f4` | primary |
| `--popover` | `#313244` | overlay |
| `--popover-foreground` | `#cdd6f4` | primary |
| `--primary` | `#cdd6f4` | primary |
| `--primary-foreground` | `#1e1e2e` | base |
| `--secondary` | `#313244` | overlay |
| `--secondary-foreground` | `#a6adc8` | secondary |
| `--muted` | `#313244` | overlay |
| `--muted-foreground` | `#585b70` | muted |
| `--accent` | `#89b4fa` | accent-blue |
| `--accent-foreground` | `#1e1e2e` | base |
| `--destructive` | `#f38ba8` | accent-red |
| `--destructive-foreground` | `#1e1e2e` | base |
| `--border` | `#313244` | border |
| `--input` | `#313244` | border |
| `--ring` | `#89b4fa` | accent-blue |
| `--radius` | `0.5rem` | — |
| `--chart-1` | `#89b4fa` | accent-blue |
| `--chart-2` | `#a6e3a1` | accent-green |
| `--chart-3` | `#f9e2af` | accent-yellow |
| `--chart-4` | `#f38ba8` | accent-red |
| `--chart-5` | `#cba6f7` | accent-magenta |

App-specific additions (not part of shadcn standard):

| Variable | Value | Purpose |
|---|---|---|
| `--success` | `#a6e3a1` | Git new/added, archived tasks |
| `--success-foreground` | `#1e1e2e` | — |
| `--warning` | `#f9e2af` | Git modified, default task status |
| `--warning-foreground` | `#1e1e2e` | — |

## Chunk 4.5: shadcn/ui Primitives

### File Structure

```
packages/ui/
├── components.json              # shadcn config
└── src/
    ├── lib/
    │   └── utils.ts             # cn() utility (clsx + tailwind-merge)
    ├── styles/
    │   └── global.css           # Updated with shadcn CSS vars
    └── components/
        └── ui/                  # shadcn components
            ├── button.tsx
            ├── input.tsx
            ├── textarea.tsx
            ├── card.tsx
            ├── select.tsx
            ├── tabs.tsx
            ├── collapsible.tsx
            ├── scroll-area.tsx
            ├── tooltip.tsx
            ├── separator.tsx
            ├── badge.tsx
            ├── dropdown-menu.tsx
            └── dialog.tsx
```

### Tasks

**4.5.1: Update global.css with shadcn theme** — Replace the `@theme` block in `global.css` (from Chunk 1) with shadcn's CSS variable convention using the Catppuccin Mocha values from the mapping table above. Include `--success`, `--warning` custom tokens.

**4.5.2: Initialize shadcn CLI + cn() utility** — Run `bunx shadcn@latest init` in `packages/ui` with New York style, Tailwind v4, paths pointing to `src/components/ui` and `src/lib/utils`. Install `class-variance-authority` as an explicit dependency. This generates `components.json` and `src/lib/utils.ts`.

**4.5.3: Pull shadcn components** — Pull all 13 components: button, input, textarea, card, select, tabs, collapsible, scroll-area, tooltip, separator, badge, dropdown-menu, dialog.

**4.5.4: Add app-specific variants** — Extend the shadcn components' existing `cva()` configs:

- **Button**: Add `size: "icon-sm"` variant (`h-6 w-6 rounded-sm` — 24x24 for close/revert buttons) and `variant: "sidebar"` (`text-muted-foreground hover:bg-muted hover:text-foreground`).
- **Badge**: Add a `colorScheme` variant as a second cva axis alongside the existing `variant`. Values: `claude` (`bg-success/20 text-success border-success/30`), `codex` (`bg-warning/20 text-warning border-warning/30`), `active` (`bg-accent/20 text-accent border-accent/30`), `archived` (`bg-muted text-muted-foreground`). Used as `<Badge variant="outline" colorScheme="claude">`. This is a compound variant — `colorScheme` only applies when `variant` is `"outline"` or `"default"`.

**4.5.5: Verify components render** — Create a temporary ComponentShowcase page (not committed) that renders every pulled component with the Catppuccin theme. Run `bunx tsc --noEmit` to verify no type errors. Start dev server and visually confirm colors/spacing. Delete the showcase file before committing.

### Dependencies Added

- `class-variance-authority`, `clsx`, `tailwind-merge`
- `@radix-ui/react-collapsible`, `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-scroll-area`, `@radix-ui/react-select`, `@radix-ui/react-separator`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`
- `lucide-react`

## Chunk 5 Revised: UI Core

Tasks 5.1–5.3 (Vite config, WebSocket hook/provider, Zustand stores) are **unchanged** — they contain no UI elements.

Tasks 5.4–5.6 are revised:

### 5.4: AppShell Layout

- Collapsed file/task rails remain as styled `<div>` elements (not Buttons) because they display vertically-rotated text labels ("FILES", "TASK") using `[writing-mode:vertical-rl]`. The `<div>` gets `onClick`, `cursor-pointer`, and appropriate hover classes via `cn()`.
- `<Separator orientation="vertical" />` between zones.
- Sidebar width still uses `style={{ width: sidebarWidth }}` for drag-resize.
- All classes merged with `cn()`.

### 5.5: Task Sidebar Components

**TaskSidebar:**
- Search → `<Input placeholder="Search tasks..." />`
- "+" button → `<Button variant="ghost" size="icon-sm"><Plus /></Button>`
- Task list → wrapped in `<ScrollArea>`
- Bottom bar actions → `<Button variant="ghost" size="sm">`

**ProjectGroup:**
- Collapse/expand → `<Collapsible>` + `<CollapsibleTrigger>` + `<CollapsibleContent>`
- Task count → `<Badge variant="secondary">`

**TaskCard:**
- Custom `cva()`: `taskCardVariants` with two variant axes:
  - `active: { true: 'bg-muted', false: 'bg-transparent hover:bg-muted/50' }` (boolean)
  - `status: { active: 'border-l-accent', archived: 'border-l-success', default: 'border-l-warning' }` — maps from `task.status`: `'active'` → `active`, `'archived'` → `archived`. Tasks that are neither use `default` (yellow).
- Session indicators → `<Badge variant="outline" colorScheme="claude|codex">`

### 5.6: Workspace Skeleton

**TaskHeader:**
- Branch label → `<Badge variant="outline">`

**TabBar:**
- Tab strip → `<Tabs>` / `<TabsList>` / `<TabsTrigger>`
- Custom `cva()`: `tabVariants({ type })` for tab type coloring (claude=green, codex=yellow, editor/browser/changes=muted).
- Close button per tab → `<Button variant="ghost" size="icon-sm"><X /></Button>`
- New tab → `<DropdownMenu>` with Claude Code / Codex / Browser options with icons.

**TabContent / Workspace:** Logic unchanged, empty states use Tailwind classes.

## Chunk 6 Revised: UI Panes

All inline `style={{}}` eliminated except documented exceptions.

### 6.1: TerminalPane (minor)

Replace `style={{ flex: 1, overflow: 'hidden' }}` with `className="flex-1 overflow-hidden"`. xterm theme stays in Terminal constructor. Everything else unchanged.

### 6.2: EditorPane (revised)

- Container: `className="flex-1 relative"`
- Save button: `<Button size="sm" className="absolute top-2 right-2 z-10">Save</Button>`
- Loading state: Tailwind absolute centering classes.
- Monaco container: `className="w-full h-full"`

### 6.3: ChangesPane (heavy rewrite)

- File list in `<ScrollArea className="max-h-[40%]">`
- Branch label → `<Badge variant="outline">`
- File status prefix → `<Badge variant="outline" colorScheme={gitStatusToColorScheme(file.status)}>` where `gitStatusToColorScheme` is a local helper mapping git status strings to Badge `colorScheme` values: `'new'|'untracked'` → `'claude'` (green), `'modified'` → `'codex'` (yellow), `'deleted'` → `undefined` (uses destructive styling via a separate class).
- Revert action → `<Tooltip><Button variant="ghost" size="icon-sm"><Undo2 /></Button></Tooltip>`
- Selected file highlight: `cn('...', selected && 'bg-muted')`
- Diff viewer in `<ScrollArea className="flex-1">` with `diffLineVariants` cva:
  - `added` → `text-success`
  - `removed` → `text-destructive`
  - `hunk` → `text-accent`
  - `context` → `text-secondary-foreground`

### 6.4: BrowserPane (revised)

- URL bar layout: Tailwind flex with gap.
- Back/reload → `<Button variant="ghost" size="icon-sm">` with lucide icons.
- URL input → `<Input className="flex-1 h-7 text-xs" />`
- Webview: `className="flex-1"`

### 6.5: FileExplorer + FileTree (heavy rewrite)

**FileTree:**
- Directory nodes → `<Collapsible defaultOpen={depth < 2}>`
- Git status coloring → `fileNodeVariants` cva with `gitStatus` variant: `new` / `untracked` → `text-success`, `modified` → `text-warning`, `deleted` → `text-destructive`, `clean` (default) → `text-secondary-foreground`.
- Indentation: `style={{ paddingLeft: depth * 12 + 8 }}` (dynamic, exception).
- All other styles → Tailwind: `text-xs whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer`.

**FileExplorer:**
- Layout: `className="flex flex-col h-full"`
- Header with label + close `<Button>` + `<Separator />`
- Tree in `<ScrollArea className="flex-1 py-1">`

### 6.6: TaskInfoPanel (revised)

- Same header pattern as FileExplorer (label + close + separator).
- Content in `<ScrollArea className="flex-1 p-2">`
- Description/Notes → `<Textarea>`
- Branch → `<Badge variant="outline">`
- Sections separated with `<Separator className="my-3" />`
- Labels: `className="text-muted-foreground text-[9px] uppercase"`

### 6.7: Wire panes + App (minor)

Same wiring logic, empty states use Tailwind classes.

### 6.8: Final integration verify (unchanged)

Same verification steps.

## Impact on Other Chunks

**Chunk 1 (Task 1.7, Step 6):** Task 4.5.1 **replaces** the `@theme` block that Chunk 1 creates. If Chunk 1 has already been implemented, Task 4.5.1 overwrites `global.css` with the shadcn variable convention. Any Tailwind classes using the old token names (`bg-base`, `bg-surface`, `bg-overlay`, `text-primary`, `text-secondary`, `text-muted`, `border-border`, `text-accent-*`) must be updated to shadcn equivalents (`bg-background`, `bg-card`, `bg-popover`, `text-foreground`, `text-secondary-foreground`, `text-muted-foreground`, `border-border`, `text-accent`). Since no UI components exist yet when Chunk 4.5 runs (it precedes Chunks 5 & 6), only the `global.css` file and possibly `index.html` body class need updating. The Chunk 1 plan doc should note this upcoming replacement.

**Chunks 2–4:** No impact. Backend/Electron have no UI components.

## Provider Setup

`<TooltipProvider>` from `@radix-ui/react-tooltip` must wrap the app for tooltips to work. Add it in `App.tsx` inside `<WebSocketProvider>` (Task 5.6 or 6.7 when wiring the final App).

## Icon Inventory

Lucide icons used across Chunks 5 & 6: `Plus`, `X`, `ChevronDown`, `ChevronRight`, `ArrowLeft`, `RotateCw`, `Undo2`, `Terminal`, `Code`, `Globe`, `FileText`, `GitBranch`. These are imported per-component from `lucide-react`.

## Forward-Looking Variables

The `--chart-1..5` CSS variables are included for shadcn convention completeness. They are not referenced by any component in Chunks 5 & 6 but will be available for future data visualization features.

## cva Convention

Every app component with visual variants follows this pattern:

```typescript
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const myComponentVariants = cva('base-classes', {
  variants: { /* ... */ },
  defaultVariants: { /* ... */ },
});

interface MyComponentProps extends VariantProps<typeof myComponentVariants> {
  className?: string;
  // ... other props
}

export function MyComponent({ className, variant, ...props }: MyComponentProps) {
  return <div className={cn(myComponentVariants({ variant }), className)} {...props} />;
}
```

All app components accept `className` and merge it via `cn()` so parents can override styles.
