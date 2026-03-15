# Terminal Flickering & Scroll-to-Top During Large Output

**Date:** 2026-03-15
**Status:** Investigated, fix pending

## Symptom

When an agent generates a code snippet or output larger than the terminal viewport height, the session window starts flickering and often scrolls to the beginning of the buffer.

## Architecture Context

- Terminal output flows: WebSocket `TERMINAL_OUTPUT` event → `term.write(data)` → xterm.js buffer → canvas/WebGL renderer
- xterm.js uses `.xterm-viewport` (a native-scrollbar div with `overflow-y: scroll`) to synchronize scroll position with the internal buffer
- `TerminalPane` uses a `ResizeObserver` (debounced 250ms) on the container div, which triggers `scheduleFit()` → `captureViewport()` → `fitTerminal()` → `restoreViewport()` → `refreshTerminal()`
- Inactive terminal tabs use `visibility: hidden` (not `display: none`) to preserve xterm's DOM measurements

## Root Causes

### 1. Global `*` CSS scrollbar rules interfere with xterm's viewport

**File:** `packages/ui/src/styles/global.css` (lines 91-98)

```css
* {
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
}
*:hover {
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
```

These apply to ALL elements, including `.xterm-viewport`. On macOS, this forces a classic (non-overlay) thin scrollbar instead of the native overlay scrollbar. xterm.js measures scrollbar width at creation time (`node_modules/@xterm/xterm/src/browser/Viewport.ts:70`):

```ts
this.scrollBarWidth = (viewportElement.offsetWidth - scrollArea.offsetWidth) || FALLBACK_SCROLL_BAR_WIDTH;
```

With `scrollbar-width: thin`, the measurement gives ~6-8px instead of 0 (overlay). The `*:hover` rule changing `scrollbar-color` can trigger repaints that coincide with rapid writes, and the non-overlay scrollbar changes how the browser handles `scrollTop` synchronization.

### 2. rAF ordering race between xterm's viewport sync and `scheduleFit`

**File:** `packages/ui/src/components/panes/TerminalPane.tsx`

When content is written rapidly:

1. `term.write(data)` processes data synchronously (buffer grows, `ydisp`/`baseY` update)
2. xterm calls `syncScrollArea()`, scheduling `_innerRefresh()` via `requestAnimationFrame`
3. If a `ResizeObserver` also fires, `scheduleFit()` is also scheduled via rAF (after 250ms debounce)

Both rAF callbacks may execute in the same frame. If `scheduleFit` runs **before** xterm's `_innerRefresh`:

- `captureViewport()` reads `buffer.viewportY` which hasn't been synced with the latest `scrollTop` yet
- `fitTerminal()` may resize the terminal, changing `baseY` (reflow at new column count)
- `restoreViewport()` calls `term.scrollToLine(baseY - distanceFromBottom)` with stale `distanceFromBottom`
- If `distanceFromBottom > newBaseY` (terminal gained rows, reducing baseY), `targetLine = 0` → scrolls to top

The viewport capture/restore logic in `scheduleFit` (lines 572-604):

```typescript
const viewportSnapshot = scrollToBottom ? null : captureViewport(termRef.current);
const fitResult = fitTerminal(fitRef.current, termRef.current);
// ... baseY may have changed due to resize/reflow ...
if (scrollToBottom) {
    termRef.current.scrollToBottom();
} else if (viewportSnapshot) {
    restoreViewport(termRef.current, viewportSnapshot); // uses stale distanceFromBottom with new baseY
}
```

### 3. Unconditional `refreshTerminal` forces full repaint

**File:** `packages/ui/src/components/panes/TerminalPane.tsx` (line 599)

`scheduleFit` always calls `refreshTerminal(term)` → `term.refresh(0, term.rows - 1)`, forcing a complete repaint of all visible rows. During rapid content writing, this creates visual flickering as the renderer redraws while new data is simultaneously being processed.

## Proposed Fix

### Fix 1: Exclude xterm viewport from global scrollbar CSS

In `packages/ui/src/styles/global.css`, add an override to reset xterm's viewport scrollbar to native behavior:

```css
/* Reset xterm viewport to native scrollbar behavior.
   The global * { scrollbar-width: thin } forces a non-overlay scrollbar
   that interferes with xterm's scroll synchronization. */
.xterm .xterm-viewport {
    scrollbar-width: auto;
    scrollbar-color: auto;
}

/* Keep the existing hover rules for xterm scrollbar visibility */
.xterm:hover .xterm-viewport {
    scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
```

### Fix 2: Skip viewport capture/restore when auto-scrolling at bottom

In `scheduleFit` (`TerminalPane.tsx`), detect when the user is at the bottom and let xterm handle scroll position naturally instead of capturing/restoring:

```typescript
const scheduleFit = useCallback(
    (forceResize = false, focus = false, scrollToBottom = false, retries = 2) => {
        if (fitFrameRef.current !== null) {
            cancelAnimationFrame(fitFrameRef.current);
        }
        fitFrameRef.current = requestAnimationFrame(() => {
            fitFrameRef.current = null;
            if (!visibleRef.current || !fitRef.current || !termRef.current) return;

            // Only capture/restore viewport if the user has scrolled up.
            // When at the bottom (auto-scrolling), let xterm handle scroll
            // position naturally to avoid rAF ordering races.
            const buffer = termRef.current.buffer.active;
            const isAtBottom = buffer.baseY === buffer.viewportY;
            const viewportSnapshot =
                scrollToBottom || isAtBottom ? null : captureViewport(termRef.current);

            const fitResult = fitTerminal(fitRef.current, termRef.current);
            if (!fitResult.measured) {
                if (retries > 0) {
                    scheduleFit(forceResize, focus, scrollToBottom, retries - 1);
                } else if (focus && termRef.current) {
                    termRef.current.focus();
                }
                return;
            }

            sendResizeIfNeeded(forceResize || fitResult.resized);

            if (scrollToBottom) {
                termRef.current.scrollToBottom();
            } else if (viewportSnapshot) {
                restoreViewport(termRef.current, viewportSnapshot);
            }
            // else: at bottom, xterm handles auto-scroll via _innerRefresh

            if (fitResult.resized) {
                refreshTerminal(termRef.current);
            }
            if (focus) termRef.current.focus();
        });
    },
    [sendResizeIfNeeded],
);
```

### Fix 3: Only call `refreshTerminal` when dimensions actually changed

Change line 599 from unconditional `refreshTerminal(termRef.current)` to conditional on `fitResult.resized` (shown in Fix 2 above). This avoids unnecessary full-screen repaints during rapid content writing when the container size hasn't actually changed.

## Key Files

| File | Role |
|------|------|
| `packages/ui/src/components/panes/TerminalPane.tsx` | Terminal init, fit/resize, scroll capture/restore |
| `packages/ui/src/components/workspace/TabContent.tsx` | Tab visibility toggle (invisible/visible) |
| `packages/ui/src/styles/global.css` | Global scrollbar CSS rules |
| `node_modules/@xterm/xterm/src/browser/Viewport.ts` | xterm's scroll synchronization (read-only reference) |
| `node_modules/@xterm/addon-fit/src/FitAddon.ts` | Dimension measurement using scrollBarWidth (read-only reference) |
