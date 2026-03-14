# Tooltip System Replacement

Replace Radix UI tooltip with a custom implementation using `@floating-ui/react` for positioning and a module-level safety net for reliable dismissal.

## Problem

Radix UI tooltips use JavaScript `pointerenter`/`pointerleave` events to manage open/close state. When the mouse moves quickly across panel boundaries (especially into elements that capture pointer events like terminal canvases), the `pointerleave` event can be missed, leaving the tooltip stuck on screen.

## Approach

Custom tooltip component backed by `@floating-ui/react` for positioning, with our own event handling and a global safety net. The component API remains identical to the current Radix-based implementation, so migration is a drop-in replacement with no changes to consuming components.

## Component API

Identical to current usage:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button>Hover me</button>
  </TooltipTrigger>
  <TooltipContent side="right" sideOffset={4}>
    Tooltip text
  </TooltipContent>
</Tooltip>

// Controlled mode (used by TruncatedText)
<Tooltip open={open} onOpenChange={setOpen}>
  ...
</Tooltip>
```

`TooltipProvider` becomes a no-op passthrough wrapper (preserves compatibility, can be removed later).

## Architecture

### Tooltip Manager (module-level singleton)

A module-level object (not a React context) that:
- Tracks the currently open tooltip (trigger element ref + close callback)
- Attaches a single `document.addEventListener('mouseover')` listener on first tooltip mount, removes on last unmount
- On every `mouseover` event: checks if the event target is inside the current trigger or tooltip content element. If not, calls the close callback immediately
- Ensures only one tooltip is open at a time (opening a new one closes the previous)

### Event Model

1. `TooltipTrigger` attaches `onMouseEnter` → opens tooltip, `onMouseLeave` → closes tooltip
2. On open, the tooltip registers itself with the tooltip manager
3. On close (or unmount), it unregisters
4. The manager's global `mouseover` listener acts as a safety net — if the mouse is detected anywhere outside trigger+content, force close

### Positioning

- `@floating-ui/react` with `flip()`, `shift()`, `offset()` middleware
- `side` prop maps to Floating UI's `placement` parameter
- `sideOffset` maps to `offset()` middleware value
- Arrow positioned via Floating UI's `arrow()` middleware + a ref on the arrow element

### Rendering

- Content rendered via `React.createPortal` into `document.body`
- Arrow is a styled div with the same CSS classes as current implementation
- Same Tailwind animation classes preserved (`animate-in`, `fade-in-0`, `zoom-in-95`, slide transitions)

### Controlled Mode

- `open` and `onOpenChange` props on `Tooltip` work identically to current behavior
- When `open` is provided, internal state defers to it
- `onOpenChange` is called with `false` when safety net fires, so controlled consumers (like `TruncatedText`) also get force-closed

## Files Changed

- `packages/ui/src/components/ui/tooltip.tsx` — full rewrite (replace Radix with custom implementation)
- `packages/ui/package.json` — add `@floating-ui/react`, can remove `radix-ui` Tooltip if it's the only Radix primitive in use (check first)

## Files Unchanged

All tooltip consumers remain unchanged — the API is identical:
- `App.tsx`, `Button`, `TruncatedText`, `CopyButton`
- `TaskHeader`, `TabBar`, `CommitDialog`
- `TaskSidebar`, `ProjectGroup`, `TaskCard`, `NewTaskControl`
- `FileExplorer`, `FileTree`, `TaskInfoPanel`, `ChangesPane`, `BrowserPane`
