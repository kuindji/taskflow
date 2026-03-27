# Markdown Input Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating Monaco markdown editor overlay to agent sessions for composing and sending long prompts.

**Architecture:** A self-contained React component (`MarkdownInputHelper`) rendered inside each `TerminalPane` container. A Zustand store (`markdown-input-store`) manages per-session state (buffer, open/closed, position, size). The editor writes to the agent session via the existing `sendInput` path.

**Tech Stack:** React 19, Monaco Editor (already in deps), Zustand, Tailwind CSS, pointer events for drag/resize.

---

### Task 1: Create the Zustand store for editor state

**Files:**
- Create: `packages/ui/src/stores/markdown-input-store.ts`

- [ ] **Step 1: Create the store file**

```typescript
// packages/ui/src/stores/markdown-input-store.ts
import { create } from "zustand";

interface EditorState {
    buffer: string;
    isOpen: boolean;
    position: { x: number; y: number } | null;
    size: { width: number; height: number } | null;
}

interface MarkdownInputState {
    editors: Record<string, EditorState>;
    open: (sessionId: string) => void;
    close: (sessionId: string) => void;
    toggle: (sessionId: string) => void;
    setBuffer: (sessionId: string, text: string) => void;
    clearBuffer: (sessionId: string) => void;
    setPosition: (sessionId: string, position: { x: number; y: number }) => void;
    setSize: (sessionId: string, size: { width: number; height: number }) => void;
    cleanup: (sessionId: string) => void;
}

function getEditor(state: MarkdownInputState, sessionId: string): EditorState {
    return state.editors[sessionId] ?? { buffer: "", isOpen: false, position: null, size: null };
}

const useMarkdownInputStore = create<MarkdownInputState>((set) => ({
    editors: {},

    open(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), isOpen: true },
            },
        }));
    },

    close(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), isOpen: false },
            },
        }));
    },

    toggle(sessionId) {
        set((state) => {
            const editor = getEditor(state, sessionId);
            return {
                editors: {
                    ...state.editors,
                    [sessionId]: { ...editor, isOpen: !editor.isOpen },
                },
            };
        });
    },

    setBuffer(sessionId, text) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), buffer: text },
            },
        }));
    },

    clearBuffer(sessionId) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), buffer: "" },
            },
        }));
    },

    setPosition(sessionId, position) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), position },
            },
        }));
    },

    setSize(sessionId, size) {
        set((state) => ({
            editors: {
                ...state.editors,
                [sessionId]: { ...getEditor(state, sessionId), size },
            },
        }));
    },

    cleanup(sessionId) {
        set((state) => {
            const { [sessionId]: _, ...rest } = state.editors;
            return { editors: rest };
        });
    },
}));

export { useMarkdownInputStore, getEditor };
export type { EditorState, MarkdownInputState };
```

- [ ] **Step 2: Verify the store compiles**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No errors related to markdown-input-store.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/markdown-input-store.ts
git commit -m "feat: add zustand store for markdown input helper state"
```

---

### Task 2: Create the MarkdownInputHelper component — trigger button

**Files:**
- Create: `packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx`
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx`

This task adds the floating trigger button (pen icon) in the bottom-right corner, visible only for agent sessions. The editor panel itself comes in Task 3.

- [ ] **Step 1: Create the component with trigger button only**

```typescript
// packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx
import { useCallback } from "react";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import type { Tab } from "@/stores/session-helpers";

const AGENT_SESSION_TYPES: ReadonlySet<Tab["type"]> = new Set([
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
]);

interface MarkdownInputHelperProps {
    sessionId: string;
    sessionType: Tab["type"];
}

function MarkdownInputHelper({ sessionId, sessionType }: MarkdownInputHelperProps) {
    const isOpen = useMarkdownInputStore((s) => getEditor(s, sessionId).isOpen);
    const toggle = useMarkdownInputStore((s) => s.toggle);

    const handleToggle = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    if (!AGENT_SESSION_TYPES.has(sessionType)) return null;
    if (isOpen) return null; // Editor panel will render instead (Task 3)

    return (
        <button
            type="button"
            onClick={handleToggle}
            className="absolute bottom-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Markdown Input (⌘⇧I)"
        >
            <PenIcon />
        </button>
    );
}

function PenIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    );
}

export { MarkdownInputHelper, AGENT_SESSION_TYPES };
```

- [ ] **Step 2: Integrate into TerminalPane**

In `packages/ui/src/components/panes/TerminalPane.tsx`, the component needs the session type. The `TerminalPane` doesn't currently receive `type`, so we need to add it to the props and pass it through.

Add the import at the top (after existing imports):
```typescript
import { MarkdownInputHelper } from "./terminal/MarkdownInputHelper";
```

Add `sessionType` to the `TerminalPaneProps` interface:
```typescript
interface TerminalPaneProps {
    taskId?: string;
    projectId?: string;
    master?: boolean;
    sessionId: string;
    sessionType: string;
    visible: boolean;
}
```

Update the function signature:
```typescript
function TerminalPane({ taskId, projectId, master, sessionId, sessionType, visible }: TerminalPaneProps) {
```

Add `<MarkdownInputHelper>` inside the return JSX, after the initializing overlay:
```tsx
return (
    <div className="bg-card relative flex-1 overflow-hidden p-3">
        <div
            ref={containerRef}
            className={cn(
                "h-full overflow-hidden",
                dragOver && "ring-primary/50 ring-2 ring-inset",
            )}
            style={{ overflowAnchor: "none" }}
            onClick={handleContainerClick}
        />
        {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <div className="border-muted-foreground h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
                    <span className="text-muted-foreground text-sm">Starting agent...</span>
                </div>
            </div>
        )}
        <MarkdownInputHelper sessionId={sessionId} sessionType={sessionType} />
    </div>
);
```

- [ ] **Step 3: Find and update the TerminalPane call site to pass sessionType**

Search for where `<TerminalPane` is rendered. It will need the tab's `type` passed as `sessionType`. Find the parent component and add the prop. The exact file will be found by searching:

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && grep -rn '<TerminalPane' packages/ui/src/`

Update each call site to pass `sessionType={tab.type}` (or equivalent based on the variable name at the call site).

- [ ] **Step 4: Verify it compiles and renders**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No type errors.

Manually verify: open an agent session — the pen button should appear in the bottom-right. Open a shell session — no button.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx packages/ui/src/components/panes/TerminalPane.tsx
# Also add the parent file that was modified to pass sessionType
git commit -m "feat: add markdown input helper trigger button for agent sessions"
```

---

### Task 3: Create the floating editor panel with Monaco

**Files:**
- Modify: `packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx`

This task adds the floating Monaco editor panel that appears when the trigger button is clicked.

- [ ] **Step 1: Add constants and the editor panel to the component**

Add these constants at the top of `MarkdownInputHelper.tsx`:

```typescript
import { useCallback, useRef, useEffect } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { useSettingsStore } from "@/stores/settings-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import type { Tab } from "@/stores/session-helpers";

const AGENT_SESSION_TYPES: ReadonlySet<Tab["type"]> = new Set([
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
]);

const DEFAULT_WIDTH = 480;
const DEFAULT_HEIGHT = 220;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 150;
const CONTAINER_PADDING = 12;
```

- [ ] **Step 2: Add the EditorPanel sub-component**

Add inside `MarkdownInputHelper.tsx`, before the `MarkdownInputHelper` function:

```typescript
interface EditorPanelProps {
    sessionId: string;
    containerRef: React.RefObject<HTMLDivElement | null>;
    onSend: () => void;
    onInsert: () => void;
    onClose: () => void;
}

function EditorPanel({ sessionId, containerRef, onSend, onInsert, onClose }: EditorPanelProps) {
    const editorState = useMarkdownInputStore((s) => getEditor(s, sessionId));
    const setPosition = useMarkdownInputStore((s) => s.setPosition);
    const setSize = useMarkdownInputStore((s) => s.setSize);
    const setBuffer = useMarkdownInputStore((s) => s.setBuffer);

    const fontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const fontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );

    const panelRef = useRef<HTMLDivElement>(null);
    const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const isDragging = useRef(false);
    const isResizing = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    // Compute clamped position and size
    const containerRect = containerRef.current?.getBoundingClientRect();
    const maxW = (containerRect?.width ?? 600) - CONTAINER_PADDING * 2;
    const maxH = (containerRect?.height ?? 400) - CONTAINER_PADDING * 2;

    const width = Math.min(Math.max(editorState.size?.width ?? DEFAULT_WIDTH, MIN_WIDTH), maxW);
    const height = Math.min(Math.max(editorState.size?.height ?? DEFAULT_HEIGHT, MIN_HEIGHT), maxH);

    // Default position: bottom center
    const defaultX = Math.max(0, ((containerRect?.width ?? 600) - width) / 2);
    const defaultY = Math.max(0, (containerRect?.height ?? 400) - height - CONTAINER_PADDING);

    const rawX = editorState.position?.x ?? defaultX;
    const rawY = editorState.position?.y ?? defaultY;
    const x = Math.min(Math.max(0, rawX), Math.max(0, (containerRect?.width ?? 600) - width));
    const y = Math.min(Math.max(0, rawY), Math.max(0, (containerRect?.height ?? 400) - height));

    // Monaco setup via callback ref
    const editorContainerRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return;
            if (monacoRef.current) return; // Already created

            const editor = monaco.editor.create(node, {
                value: editorState.buffer,
                language: "markdown",
                theme: MONACO_THEME_NAME,
                fontFamily,
                fontSize,
                wordWrap: "on",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                lineNumbers: "off",
                folding: false,
                glyphMargin: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 0,
                padding: { top: 10, bottom: 10 },
                renderLineHighlight: "none",
                overviewRulerBorder: false,
                scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                },
            });

            monacoRef.current = editor;

            editor.onDidChangeModelContent(() => {
                setBuffer(sessionId, editor.getValue());
            });

            // Cmd+Enter to send
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
                onSend();
            });

            editor.focus();
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time setup, buffer read from ref
        [sessionId, fontFamily, fontSize],
    );

    // Dispose Monaco on unmount
    useEffect(() => {
        return () => {
            if (monacoRef.current) {
                monacoRef.current.dispose();
                monacoRef.current = null;
            }
        };
    }, []);

    // Update Monaco font when settings change
    useEffect(() => {
        if (monacoRef.current) {
            monacoRef.current.updateOptions({ fontFamily, fontSize });
        }
    }, [fontFamily, fontSize]);

    // --- Drag handlers ---
    const handleDragStart = useCallback(
        (e: React.PointerEvent) => {
            if (isResizing.current) return;
            isDragging.current = true;
            const panel = panelRef.current;
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            const containerR = containerRef.current?.getBoundingClientRect();
            dragOffset.current = {
                x: e.clientX - rect.left + (containerR?.left ?? 0),
                y: e.clientY - rect.top + (containerR?.top ?? 0),
            };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        },
        [containerRef],
    );

    const handleDragMove = useCallback(
        (e: React.PointerEvent) => {
            if (!isDragging.current) return;
            const containerR = containerRef.current?.getBoundingClientRect();
            if (!containerR) return;
            const newX = e.clientX - dragOffset.current.x;
            const newY = e.clientY - dragOffset.current.y;
            const clampedX = Math.min(Math.max(0, newX), Math.max(0, containerR.width - width));
            const clampedY = Math.min(Math.max(0, newY), Math.max(0, containerR.height - height));
            setPosition(sessionId, { x: clampedX, y: clampedY });
        },
        [containerRef, sessionId, width, height, setPosition],
    );

    const handleDragEnd = useCallback(() => {
        isDragging.current = false;
    }, []);

    // --- Resize handlers ---
    const handleResizeStart = useCallback(
        (e: React.PointerEvent) => {
            isResizing.current = true;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            e.stopPropagation();
        },
        [],
    );

    const handleResizeMove = useCallback(
        (e: React.PointerEvent) => {
            if (!isResizing.current) return;
            const containerR = containerRef.current?.getBoundingClientRect();
            if (!containerR) return;
            const newW = Math.min(
                Math.max(MIN_WIDTH, e.clientX - containerR.left - x),
                containerR.width - x,
            );
            const newH = Math.min(
                Math.max(MIN_HEIGHT, e.clientY - containerR.top - y),
                containerR.height - y,
            );
            setSize(sessionId, { width: newW, height: newH });
        },
        [containerRef, sessionId, x, y, setSize],
    );

    const handleResizeEnd = useCallback(() => {
        isResizing.current = false;
    }, []);

    const [dropdownOpen, setDropdownOpen] = useState(false);

    return (
        <div
            ref={panelRef}
            className="absolute z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            style={{ left: x, top: y, width, height }}
        >
            {/* Drag zone — top strip */}
            <div
                className="flex shrink-0 cursor-grab items-center justify-between px-2.5 py-1.5 active:cursor-grabbing"
                onPointerDown={handleDragStart}
                onPointerMove={handleDragMove}
                onPointerUp={handleDragEnd}
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-[10px] tracking-wider text-muted-foreground/40">⋮⋮</span>
                    <span className="text-[10px] text-muted-foreground/60 font-sans">
                        Markdown Input
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                >
                    ×
                </button>
            </div>

            {/* Monaco editor area */}
            <div
                ref={editorContainerRef}
                className="min-h-0 flex-1 overflow-hidden [&_.monaco-editor]:!border-none [&_.monaco-editor]:!outline-none"
            />

            {/* Footer — same bg, no border */}
            <div className="flex shrink-0 items-center justify-between px-2.5 py-1.5">
                <span className="text-[10px] text-muted-foreground/30 font-sans">⌘⇧I</span>
                <div className="relative flex items-center">
                    <button
                        type="button"
                        onClick={onSend}
                        className="rounded-l-md bg-primary px-3 py-1 text-[11px] font-sans text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        Send ↵
                    </button>
                    <button
                        type="button"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1 text-[9px] text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                        ▾
                    </button>
                    {dropdownOpen && (
                        <div className="absolute bottom-full right-0 mb-1 rounded-md border border-border bg-popover p-1 shadow-md">
                            <button
                                type="button"
                                onClick={() => {
                                    setDropdownOpen(false);
                                    onInsert();
                                }}
                                className="w-full rounded px-3 py-1 text-left text-[11px] font-sans text-popover-foreground transition-colors hover:bg-accent"
                            >
                                Insert (no submit)
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Resize handle — bottom right corner */}
            <div
                className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize"
                onPointerDown={handleResizeStart}
                onPointerMove={handleResizeMove}
                onPointerUp={handleResizeEnd}
            />
        </div>
    );
}
```

- [ ] **Step 3: Update the main MarkdownInputHelper to render the editor panel**

Replace the `MarkdownInputHelper` function body with:

```typescript
function MarkdownInputHelper({ sessionId, sessionType }: MarkdownInputHelperProps) {
    const isOpen = useMarkdownInputStore((s) => getEditor(s, sessionId).isOpen);
    const toggle = useMarkdownInputStore((s) => s.toggle);
    const clearBuffer = useMarkdownInputStore((s) => s.clearBuffer);
    const containerRef = useRef<HTMLDivElement>(null);

    const sendInput = useSessionStore((s) => s.sendInput);

    const handleToggle = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    const handleSend = useCallback(() => {
        const buffer = getEditor(useMarkdownInputStore.getState(), sessionId).buffer;
        if (!buffer.trim()) return;
        sendInput(sessionId, buffer + "\r");
        clearBuffer(sessionId);
    }, [sessionId, sendInput, clearBuffer]);

    const handleInsert = useCallback(() => {
        const buffer = getEditor(useMarkdownInputStore.getState(), sessionId).buffer;
        if (!buffer.trim()) return;
        sendInput(sessionId, buffer);
        clearBuffer(sessionId);
    }, [sessionId, sendInput, clearBuffer]);

    const handleClose = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    if (!AGENT_SESSION_TYPES.has(sessionType)) return null;

    return (
        <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
            {isOpen ? (
                <div className="pointer-events-auto h-full">
                    <EditorPanel
                        sessionId={sessionId}
                        containerRef={containerRef}
                        onSend={handleSend}
                        onInsert={handleInsert}
                        onClose={handleClose}
                    />
                </div>
            ) : (
                <button
                    type="button"
                    onClick={handleToggle}
                    className="pointer-events-auto absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground"
                    title="Markdown Input (⌘⇧I)"
                >
                    <PenIcon />
                </button>
            )}
        </div>
    );
}
```

Note: Add `import { useState } from "react"` and `import { useSessionStore } from "@/stores/session-store"` to the imports. Update the `useRef` import to include it. The full import block becomes:

```typescript
import { useCallback, useRef, useEffect, useState } from "react";
import * as monaco from "monaco-editor";
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_SIZE } from "@taskflow/shared";
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import type { Tab } from "@/stores/session-helpers";
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No type errors.

- [ ] **Step 5: Manual verification**

Open an agent session. Click the pen button. The editor panel should:
- Appear at bottom-center of the terminal pane
- Have Monaco with markdown syntax highlighting
- Be draggable via the top strip
- Be resizable via the bottom-right corner
- Send button writes text to terminal + submits
- Insert (from dropdown) writes text without submitting
- Close button (×) hides the panel, button reappears

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx
git commit -m "feat: add floating monaco editor panel for markdown input helper"
```

---

### Task 4: Add keyboard shortcut (⌘⇧I) to toggle the editor

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx`

- [ ] **Step 1: Add the shortcut to the custom key event handler**

In `TerminalPane.tsx`, inside the `term.attachCustomKeyEventHandler` callback (around line 157), add a check for Cmd+Shift+I before the other modifier checks:

```typescript
// ⌘⇧I — toggle markdown input helper
if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "I") {
    if (event.type === "keydown") {
        useMarkdownInputStore.getState().toggle(sessionId);
    }
    return false;
}
```

Add the import at the top of `TerminalPane.tsx`:
```typescript
import { useMarkdownInputStore } from "@/stores/markdown-input-store";
```

This goes right after the Shift+Enter handler and before the modifier key bubble-through checks.

- [ ] **Step 2: Add global keyboard shortcut for when Monaco has focus**

When the Monaco editor is focused, xterm's key handler doesn't fire. The editor panel already registers Cmd+Enter for Send. We need to add Cmd+Shift+I to close the editor from within Monaco.

In `MarkdownInputHelper.tsx`, inside the `editorContainerRef` callback, after the Cmd+Enter command:

```typescript
// Cmd+Shift+I to close editor
editor.addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI,
    () => {
        onClose();
    },
);
```

- [ ] **Step 3: Verify it compiles and test**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No type errors.

Manual test:
- Focus terminal, press ⌘⇧I → editor opens
- Focus editor, press ⌘⇧I → editor closes
- Focus editor, press ⌘↵ → sends content

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx
git commit -m "feat: add keyboard shortcut (⌘⇧I) to toggle markdown input helper"
```

---

### Task 5: Cleanup on session close

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx`

When a session is destroyed, its editor state should be cleaned up.

- [ ] **Step 1: Add cleanup call in the TerminalPane unmount**

In `TerminalPane.tsx`, find the main `useEffect` cleanup (the `return () => {` block around line 193). Add the cleanup call alongside `scheduleDetach`:

```typescript
// Clean up markdown input state when the terminal pane is destroyed.
// Only if the session is exiting (not just a tab switch).
```

Actually, a better approach: add a `useEffect` that watches for session exit and cleans up:

```typescript
useEffect(() => {
    return () => {
        // Cleanup markdown input state when component unmounts permanently.
        // The scheduleDetach grace period handles tab switches; this handles
        // actual session destruction. We use a timeout matching the detach grace
        // to avoid cleaning up on quick tab switches.
        const id = sessionId;
        const timer = window.setTimeout(() => {
            if (!terminalCache.has(id)) {
                useMarkdownInputStore.getState().cleanup(id);
            }
        }, 100);
        return () => window.clearTimeout(timer);
    };
}, [sessionId]);
```

Wait — this would return a function from the cleanup, which is not valid. Instead, keep it simple and inline:

```typescript
useEffect(() => {
    const id = sessionId;
    return () => {
        // If the terminal cache no longer has this session after the detach
        // grace period, clean up the markdown input state.
        window.setTimeout(() => {
            if (!terminalCache.has(id)) {
                useMarkdownInputStore.getState().cleanup(id);
            }
        }, 100);
    };
}, [sessionId]);
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: clean up markdown input state on session close"
```

---

### Task 6: Close dropdown on outside click and polish

**Files:**
- Modify: `packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx`

- [ ] **Step 1: Add outside-click handler for the dropdown**

In the `EditorPanel` component, add an effect to close the dropdown when clicking outside:

```typescript
const dropdownRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
            setDropdownOpen(false);
        }
    };
    document.addEventListener("pointerdown", handleClick);
    return () => document.removeEventListener("pointerdown", handleClick);
}, [dropdownOpen]);
```

Wrap the dropdown button and menu in a `<div ref={dropdownRef}>`:

```tsx
<div ref={dropdownRef} className="relative flex items-center">
    <button
        type="button"
        onClick={onSend}
        className="rounded-l-md bg-primary px-3 py-1 text-[11px] font-sans text-primary-foreground transition-colors hover:bg-primary/90"
    >
        Send ↵
    </button>
    <button
        type="button"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="rounded-r-md border-l border-primary-foreground/20 bg-primary px-1.5 py-1 text-[9px] text-primary-foreground transition-colors hover:bg-primary/90"
    >
        ▾
    </button>
    {dropdownOpen && (
        <div className="absolute bottom-full right-0 mb-1 rounded-md border border-border bg-popover p-1 shadow-md">
            <button
                type="button"
                onClick={() => {
                    setDropdownOpen(false);
                    onInsert();
                }}
                className="w-full rounded px-3 py-1 text-left text-[11px] font-sans text-popover-foreground transition-colors hover:bg-accent"
            >
                Insert (no submit)
            </button>
        </div>
    )}
</div>
```

- [ ] **Step 2: Prevent drag from starting on close button click**

Add `onPointerDown={(e) => e.stopPropagation()}` to the close button to prevent accidental drag:

```tsx
<button
    type="button"
    onClick={onClose}
    onPointerDown={(e) => e.stopPropagation()}
    className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 transition-colors hover:text-muted-foreground"
>
    ×
</button>
```

- [ ] **Step 3: Ensure Monaco re-focuses when reopened**

When the editor panel reopens, Monaco should focus. Since the panel remounts (it's conditionally rendered), the `editor.focus()` call in the callback ref handles this. Verify this works during manual testing.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck`
Expected: No type errors.

- [ ] **Step 5: Full integration test (manual)**

1. Open agent session → pen button visible in bottom-right
2. Click pen button → editor opens at bottom-center
3. Type markdown → syntax highlighting works
4. Drag top bar → editor moves, clamped to bounds
5. Resize corner → editor resizes, min 300×150
6. Press Send → text appears in terminal + submitted
7. Editor buffer cleared after send
8. Close editor → pen button reappears
9. Reopen → editor at same position/size, buffer empty (was cleared by send)
10. Type text, close editor → reopen → buffer preserved
11. ⌘⇧I toggles from terminal and from editor
12. ⌘↵ sends from editor
13. Split dropdown → Insert writes without submitting
14. Open shell session → no pen button
15. Close agent session → editor state cleaned up

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/panes/terminal/MarkdownInputHelper.tsx
git commit -m "feat: add dropdown outside-click handling and polish for markdown input helper"
```

---

### Task 7: Lint and type-check final pass

**Files:**
- All modified files

- [ ] **Step 1: Run full lint and typecheck**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/build-terminal-markdown-editor && bun run --filter ui typecheck && bun run --filter ui lint`
Expected: Clean output, no errors.

- [ ] **Step 2: Fix any issues found**

Address lint/type errors if any. Common things to watch for:
- Unused imports
- Missing dependencies in useCallback/useEffect arrays
- Type narrowing issues

- [ ] **Step 3: Commit fixes if any**

```bash
git add -u
git commit -m "fix: resolve lint and type issues in markdown input helper"
```
