# Plan: Adopt Superset's Terminal Lifecycle Techniques

## Context

With 10+ concurrent agent sessions, rendering flakes because each always-mounted terminal holds a live WebGL + Canvas GPU context. Browsers/Electron cap WebGL contexts at ~8-16; beyond that, older contexts get silently evicted.

Superset solves this by **fully unmounting inactive terminals** and restoring them from server-side state on reattach. This plan explores adopting their key techniques.

## Current Architecture (Taskflow)

- All terminal tabs stay **permanently in DOM** (offscreen at `left:-9999em`)
- Each holds a live xterm instance with Canvas + WebGL addons (= 2 GPU contexts per terminal)
- Module-level `terminalCache: Map<sessionId, CachedTerminal>` preserves instances
- Tab switch = reposition from offscreen to visible (instant, no restore needed)
- Backend stores full JSONL history + 50KB in-memory scrollback

## Superset's Approach

- Only **active terminal** is in DOM — inactive terminals are fully unmounted
- Server-side `@xterm/headless` mirrors each terminal's state (cursor, modes, alternate screen)
- On remount: `@xterm/addon-serialize` produces a snapshot that perfectly restores the terminal
- 50ms debounced detach prevents thrashing during rapid tab switching
- Attach scheduler limits concurrent reattaches to 3, with focused pane getting priority

## Proposed Architecture

### Phase 1: Unmount/Remount with JSONL Restore

Switch from always-mounted to Superset's unmount/remount pattern, using Taskflow's **existing JSONL history** for restore.

**UI Changes (`TerminalPane.tsx` + `TabContent.tsx`):**

1. **Remove always-mounted strategy** — terminal tabs now unmount when inactive, same as editor/changes tabs. Remove `isAlwaysMounted()` and the offscreen positioning logic.

2. **Add debounced detach** (Superset pattern) — module-level `pendingDetaches: Map<string, NodeJS.Timeout>`. On unmount, schedule a 50ms delayed cleanup instead of immediate `destroyTerminal()`. On remount within 50ms, cancel the pending detach and reuse the cached instance. This handles rapid tab switching without thrashing.

3. **On remount after detach**: Request `SESSION_HISTORY` from backend, create fresh xterm instance, replay history. The existing history loading + sequence-based dedup logic already handles this correctly.

4. **Viewport scroll position**: Save `distanceFromBottom` to a module-level `Map<sessionId, number>` before detach. Restore after history replay on remount.

**What this gives us:**
- Only 1 terminal with GPU contexts at a time (the active one)
- 10, 20, 50 sessions — doesn't matter, only 1 renders
- Zero backend changes — JSONL history already exists
- Tab switch cost: ~100-200ms for history replay (acceptable)

**Trade-off vs current approach:**
- Tab switch is no longer instant — there's a brief flash as xterm reinitializes and replays history
- Large sessions (lots of output) may take longer to replay
- Raw JSONL replay doesn't preserve terminal modes (alternate screen, cursor position)

### Phase 2: Server-side Headless xterm (Superset's key technique)

Add `@xterm/headless` + `@xterm/addon-serialize` on the backend to mirror terminal state. This fixes the raw-replay limitations from Phase 1.

**Backend changes (`pty-manager.ts`):**

1. **Add headless emulator per session** — when a PTY is spawned, also create a `@xterm/headless` Terminal instance that receives the same output. This maintains an authoritative mirror of the terminal state including cursor position, modes, colors, and alternate screen buffer.

2. **Replace scrollback array with serialized snapshots** — instead of the current 50KB `string[]` scrollback, use `@xterm/addon-serialize` to produce ANSI snapshots on demand. This captures the full visual state, not just raw text.

3. **New message type: `session:snapshot`** — returns the serialized terminal state (ANSI escape sequences that reconstruct the exact visual state). Replaces or supplements `session:history` for terminal restore.

**UI changes:**

4. **Use snapshot for restore** — on remount, request `session:snapshot` instead of `session:history`. Write the snapshot ANSI to a fresh xterm instance. Result: pixel-perfect restore including TUI apps (vim, htop), cursor position, and colors.

**What this gives us (on top of Phase 1):**
- Perfect visual restore — no flicker, no lost state
- TUI apps (alternate screen) restore correctly
- Smaller payload than full JSONL replay (serialized snapshot vs raw history)
- Backend becomes the source of truth for terminal state

**Complexity cost:**
- `@xterm/headless` dependency on backend (need to verify Bun compatibility)
- Memory: one headless Terminal per active session (~few KB each, much less than a real renderer)
- Need to feed PTY output to both the headless emulator and the broadcast

### Phase 3 (Optional): Attach Scheduler

If Phase 1+2 work well but workspace switches (which restore multiple terminals for the new workspace) cause contention, add Superset's attach scheduler:

- Limit concurrent `session:snapshot` requests to 3
- Priority queue: focused/active tab gets priority 0, others get priority 1
- Handles React StrictMode double-mounts gracefully

This is likely unnecessary unless users frequently switch between workspaces with many open sessions.

## Files to Modify

### Phase 1
| File | Changes |
|------|---------|
| `packages/ui/src/components/panes/TerminalPane.tsx` | Add `pendingDetaches` map, debounced cleanup, scroll position cache. Modify unmount to schedule detach instead of immediate destroy. Modify mount to cancel pending detach or create fresh terminal. |
| `packages/ui/src/components/workspace/TabContent.tsx` | Remove `isAlwaysMounted()`, remove offscreen positioning. All tabs use same mount/unmount pattern. |

### Phase 2
| File | Changes |
|------|---------|
| `packages/backend/src/services/pty-manager.ts` | Add `@xterm/headless` emulator per session. Feed PTY output to emulator. Add `getSnapshot()` method using serialize addon. |
| `packages/backend/src/handlers/session.ts` | Add `session:snapshot` handler. |
| `packages/shared/src/constants.ts` | Add `SESSION_SNAPSHOT` message type. |
| `packages/shared/src/types/ws.ts` | Add snapshot request/response types. |
| `packages/ui/src/components/panes/TerminalPane.tsx` | Use `session:snapshot` for restore instead of `session:history`. |

## Verification

1. Open 10+ agent sessions — no rendering flaking
2. Switch tabs rapidly — debounced detach prevents thrashing, cached instances reused within 50ms
3. Switch tabs slowly — terminal restores from history/snapshot with correct scroll position
4. Run a TUI app (e.g., `vim`) in a shell tab, switch away, switch back — verify it restores correctly (Phase 2)
5. Check GPU context count in DevTools (chrome://gpu) — should show only 1-2 active contexts regardless of session count
6. Run existing tests: `bun test` in packages/backend

## Recommendation

Implement Phase 1 first — it solves the GPU context exhaustion with minimal changes and zero backend work. Phase 2 can follow if raw-replay restore quality isn't good enough (TUI apps, cursor state).
