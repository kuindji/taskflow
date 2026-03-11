# Inner Component Styling Design

## Summary

Restyle all inner components to match shadcn default sizing, spacing, typography, and roundness. Remove undersized custom font sizes (9-11px) in favor of Tailwind standard classes. Remove colored left borders from task cards. Drop uppercase labels.

## Global Pattern Changes

| Element | Current | Proposed |
|---------|---------|----------|
| Body text | `text-[11px]` | `text-sm` (14px) |
| Section labels | 9px uppercase tracking-wider | `text-xs font-medium` normal case |
| Badges | 8-10px, tight padding | `text-xs`, `px-2 py-0.5` |
| Icon buttons | `size="icon-sm"` | `size="icon"` |
| Icons in buttons | `h-3`-`h-3.5` | `h-4 w-4` |
| Panel header padding | `px-2 py-1.5` | `px-3 py-2.5` |
| Input fields | `text-[11px]`, varied heights | `text-sm`, default shadcn `h-9` |
| Border radius | `rounded` / `rounded-sm` mix | `rounded-md` consistently |

## Files to Change

### 1. `packages/ui/src/components/sidebar/TaskSidebar.tsx`

- Header "New Task" button: `text-[11px]` → `text-sm`, icon `h-3 w-3` → `h-4 w-4`
- Footer buttons ("Add Project", "Settings"): `text-[11px]` → `text-sm`
- Header padding: `p-2` → `p-2.5`
- Footer padding: `px-2.5 py-1.5` → `px-3 py-2`
- Empty state "No projects yet" div: `text-[11px]` → `text-sm`
- Empty state inline "Add Project" button: `text-[11px]` → `text-sm`

### 2. `packages/ui/src/components/sidebar/ProjectGroup.tsx`

- Group trigger text: `text-[9px] uppercase` with `tracking-wider` → `text-xs font-medium` normal case
- Badge count: `text-[8px]` → `text-xs`
- Chevron icons: `h-3 w-3` → `h-4 w-4`
- Edit input: `text-[9px] uppercase h-5` → `text-xs h-6` normal case (remove `uppercase`)
- Pencil icon: `h-2.5 w-2.5` → `h-3.5 w-3.5`
- Trigger padding: `px-2.5 py-1` → `px-3 py-1.5`

### 3. `packages/ui/src/components/sidebar/TaskCard.tsx`

- **Remove `border-l-[3px]`** from the base CVA class
- **Remove all status border color variants** (active → `border-l-accent`, archived → `border-l-success`, default → `border-l-warning`) — delete the `status` variant entirely from CVA
- Active state: `bg-muted rounded-md`
- Inactive: `bg-transparent hover:bg-muted/50 rounded-md`
- Card padding: `px-2.5 py-1.5 mx-1.5 my-0.5` → `px-3 py-2 mx-2 my-0.5`
- Card radius: `rounded` → `rounded-md`
- Title text: `text-xs` → `text-sm`
- Badge: `text-[10px]` → `text-xs`

### 4. `packages/ui/src/components/workspace/TaskHeader.tsx`

- Container padding: `px-3 py-1.5` → `px-4 py-2.5`
- Title: `text-[13px] font-bold` → `text-sm font-semibold`
- Project name: `text-[11px]` → `text-sm`
- Branch badge: `text-[9px] px-1.5 py-0` → `text-xs px-2 py-0.5`
- Icon buttons: `size="icon-sm"` → `size="icon"`
- Icons: `h-3.5 w-3.5` → `h-4 w-4`

### 5. `packages/ui/src/components/workspace/TabBar.tsx`

- Container padding: `px-2 py-0.5` → `px-3 py-1`
- Tab text: `text-[11px]` → `text-sm`
- Tab padding in CVA: `px-2 py-0.5` → `px-3 py-1`
- Tab radius in CVA: `rounded-sm` → `rounded-md`
- Close icon: `h-2.5 w-2.5` → `h-3.5 w-3.5`, button `h-4 w-4` → `h-5 w-5`
- Plus button icon: `h-3 w-3` → `h-4 w-4`
- Gap: `gap-0.5` → `gap-1`
- DropdownMenu item icons (Terminal, Code, Globe, etc.): `h-3.5 w-3.5` → `h-4 w-4`

### 6. `packages/ui/src/components/panels/FileExplorer.tsx`

- Header label: `text-[9px] uppercase tracking-wider` → `text-xs font-medium` normal case (remove `uppercase`, `tracking-wider`)
- Header padding: `px-2 py-1.5` → `px-3 py-2.5`
- Empty state text: `text-[11px]` → `text-sm`

### 7. `packages/ui/src/components/panels/FileTree.tsx`

- CVA base text: `text-xs` → `text-sm`
- File row padding: `py-0.5 px-2` → `py-1 px-3`
- Folder trigger text: `text-xs` → `text-sm`
- Chevrons: remove the `<span className="mr-1 text-[10px]">▾/▸</span>` wrapper entirely, replace with `<ChevronDown className="mr-1.5 h-4 w-4 shrink-0" />` / `<ChevronRight className="..." />`. Add `import { ChevronDown, ChevronRight } from "lucide-react"` to the file.
- Depth indentation: `depth * 12 + 8` → `depth * 16 + 12` (capped at `max(depth, 8) * 16 + 12` to prevent overflow in deeply nested trees)
- Folder trigger padding: `px-2 py-0.5` → `px-3 py-1`

### 8. `packages/ui/src/components/panels/TaskInfoPanel.tsx`

- Header label: `text-[9px] uppercase tracking-wider` → `text-xs font-medium` normal case
- Header padding: `px-2 py-1.5` → `px-3 py-2.5`
- Field labels: `text-[9px] uppercase tracking-wider` → `text-xs font-medium text-muted-foreground` normal case
- Field text: `text-[11px]` → `text-sm`
- Textarea: `text-[11px]` → `text-sm`
- ScrollArea padding: `p-2` → `p-3`
- Section spacing: `space-y-3` → `space-y-4`
- Separator margin: `my-3` → `my-4`
- Empty state: `text-[11px]` → `text-sm`

### 9. `packages/ui/src/components/panes/BrowserPane.tsx`

- URL bar padding: `px-2 py-1` → `px-3 py-1.5`
- Input: `h-7 text-xs` → `h-8 text-sm`
- Nav button icons: `h-3 w-3` → `h-4 w-4`

### 10. `packages/ui/src/components/panes/ChangesPane.tsx`

- File status row text: `text-[11px]` → `text-sm`
- FileStatusRow CVA radius: `rounded-sm` → `rounded-md`
- Revert button: `size="icon-sm"` → `size="icon-sm"` (keep — tight row context)
- Badge: `text-[9px]` and `text-[10px]` → `text-xs`
- Diff line text: `text-xs` → `text-sm`
- Status/loading text ("No changes", "Loading diff...", etc.): `text-xs` → `text-sm`
- File list section padding: `p-2` → `p-3`
- Diff section padding: `p-2` → `p-3`

### 11. `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- Optional label note: `text-[10px]` → `text-xs`

### 12. `packages/ui/src/components/sidebar/NewProjectDialog.tsx`

- Error message: keep `text-xs` (already fine)
- No other changes needed

## Notes & Accepted Trade-offs

- **Icon button size jump**: `size="icon-sm"` (32px) → `size="icon"` (36px) is a 4px increase per button. This is intentional to match shadcn defaults. Exception: ChangesPane revert button stays `icon-sm` since it's in a tight row context.
- **TaskHeader drag region height**: Growing from `py-1.5` to `py-2.5` increases the Electron drag area by ~8px. This is acceptable — the header was too tight before.
- **Tab bar height**: Growing ~4-6px total from padding increases. Acceptable trade-off for better touch targets.
- **FileTree deep nesting**: Capped at depth 8 for indentation formula to prevent overflow in narrow panels.
- **TaskCard font weight**: Active cards keep existing `font-bold`, inactive keep no weight class. No change to weight, only size.

## Non-changes

- **TerminalPane.tsx**: No class changes — uses xterm.js canvas rendering
- **EditorPane.tsx**: No class changes — uses Monaco iframe rendering
- **Dialog layouts**: Already use standard shadcn Dialog/Label/Input/Select
- **Color scheme**: No color changes
- **Component structure**: No new components, no logic changes
- **shadcn ui/ components**: No modifications to base components
