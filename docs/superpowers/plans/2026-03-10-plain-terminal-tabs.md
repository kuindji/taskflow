# Plain Terminal Tabs Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plain terminal tabs (bash, zsh, fish, etc.) to task workspaces by detecting available shells from `/etc/shells` and presenting them in the tab bar dropdown.

**Architecture:** Extend the existing session type system with a `'shell'` type. Backend parses `/etc/shells` and exposes a `shells:list` endpoint. UI fetches shells on mount and renders them as individual entries in the "+" dropdown. Shell sessions reuse `TerminalPane` — no new UI components needed.

**Tech Stack:** Bun backend (PTY via native `terminal`), React + Zustand UI, WebSocket messaging, `@taskflow/shared` types.

**Spec:** `docs/superpowers/specs/2026-03-10-plain-terminal-tabs-design.md`

---

## Chunk 1: Shared Types & Constants

### Task 1: Add `'shell'` to session type union and shell-related types

**Files:**
- Modify: `packages/shared/src/types/task.ts:3` — extend SessionRef type union
- Modify: `packages/shared/src/types/ws.ts:73` — extend SessionCreatePayload type union, add shell field
- Modify: `packages/shared/src/types/ws.ts` — add ShellInfo type
- Modify: `packages/shared/src/constants.ts:19` — add SHELLS_LIST message type

- [ ] **Step 1: Update SessionRef type**

In `packages/shared/src/types/task.ts`, change line 3:
```typescript
// Before:
type: 'claude' | 'codex';
// After:
type: 'claude' | 'codex' | 'shell';
```

- [ ] **Step 2: Update SessionCreatePayload and add shell types**

In `packages/shared/src/types/ws.ts`, change the SessionCreatePayload (line 71-76):
```typescript
// Before:
export interface SessionCreatePayload {
  taskId: string;
  type: 'claude' | 'codex';
  label?: string;
  prompt?: string;
}
// After:
export interface SessionCreatePayload {
  taskId: string;
  type: 'claude' | 'codex' | 'shell';
  label?: string;
  prompt?: string;
  shell?: string; // full path, e.g. "/bin/zsh" — required when type is 'shell'
}
```

Add new type after the existing `TerminalResizePayload` (after line 106):
```typescript
// Shell detection
export interface ShellInfo {
  name: string;
  path: string;
}
```

- [ ] **Step 3: Add `--info` color token to global CSS**

In `packages/ui/src/styles/global.css`, add the info color variables.

In the `@theme inline` block (after line 38, after `--color-warning-foreground`):
```css
  --color-info: var(--info);
  --color-info-foreground: var(--info-foreground);
```

In the `:root` block (after line 74, after `--warning-foreground`):
```css
  --info: #89b4fa;
  --info-foreground: #1e1e2e;
```

- [ ] **Step 4: Add SHELLS_LIST constant**

In `packages/shared/src/constants.ts`, add after line 19 (after `SESSION_EXITED`):
```typescript
  SHELLS_LIST: 'shells:list',
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/task.ts packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/ui/src/styles/global.css
git commit -m "feat: add shell session types, shells:list constant, and info color token"
```

---

## Chunk 2: Backend Shell Detection & Handler

### Task 2: Create shell detection utility

**Files:**
- Create: `packages/backend/src/services/shell-detector.ts`

- [ ] **Step 1: Create shell-detector.ts**

```typescript
import { readFile } from 'fs/promises';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { basename } from 'path';
import type { ShellInfo } from '@taskflow/shared';

const KNOWN_INTERACTIVE_SHELLS = new Set([
  'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'tcsh', 'csh', 'nushell', 'nu',
]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function detectShells(): Promise<ShellInfo[]> {
  let content: string;
  try {
    content = await readFile('/etc/shells', 'utf-8');
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const shells: ShellInfo[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const name = basename(trimmed);
    if (!KNOWN_INTERACTIVE_SHELLS.has(name)) continue;
    if (seen.has(name)) continue;

    if (await exists(trimmed)) {
      seen.add(name);
      shells.push({ name, path: trimmed });
    }
  }

  return shells;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/shell-detector.ts
git commit -m "feat: add shell detection service parsing /etc/shells"
```

### Task 3: Register shells:list handler and update session handler

**Files:**
- Modify: `packages/backend/src/index.ts:56` — register shells:list handler
- Modify: `packages/backend/src/handlers/session.ts:57` — handle shell type in session creation

- [ ] **Step 1: Register shells:list handler in index.ts**

In `packages/backend/src/index.ts`, add import at top (after line 9):
```typescript
import { detectShells } from './services/shell-detector';
```

After the editors detection (line 55-56), add shells detection and handler. Replace the existing `SYSTEM_INFO` handler block:
```typescript
// Before (lines 55-56):
    const editors = await detectEditors();
    router.register(MSG.SYSTEM_INFO, async () => ({ editors }));

// After:
    const editors = await detectEditors();
    const shells = await detectShells();
    router.register(MSG.SYSTEM_INFO, async () => ({ editors }));
    router.register(MSG.SHELLS_LIST, async () => ({ shells }));
    console.log(`Detected shells: ${shells.map((s) => s.name).join(', ') || 'none'}`);
```

- [ ] **Step 2: Update session handler to support shell type**

In `packages/backend/src/handlers/session.ts`, first update the destructure on line 48 to include `shell`:
```typescript
// Before:
    const { taskId, type, label, prompt } = payload as SessionCreatePayload;
// After:
    const { taskId, type, label, prompt, shell } = payload as SessionCreatePayload;
```

Then replace lines 57-61:
```typescript
// Before (lines 57-61):
    const command = type === 'claude' ? 'claude' : 'codex';
    const args: string[] = [];
    if (prompt) {
      args.push(prompt);
    }

// After:
    let command: string;
    const args: string[] = [];
    if (type === 'shell') {
      if (!shell) throw new Error('shell path is required for shell sessions');
      command = shell;
    } else {
      command = type === 'claude' ? 'claude' : 'codex';
      if (prompt) {
        args.push(prompt);
      }
    }
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/index.ts packages/backend/src/handlers/session.ts
git commit -m "feat: register shells:list handler and support shell session creation"
```

---

## Chunk 3: UI Changes

### Task 4: Update session store to support shell type

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts:7-19` — extend Tab type and createSession signature

- [ ] **Step 1: Update Tab type and createSession**

In `packages/ui/src/stores/session-store.ts`, update the Tab interface (line 9):
```typescript
// Before:
  type: 'claude' | 'codex' | 'editor' | 'changes' | 'browser';
// After:
  type: 'claude' | 'codex' | 'shell' | 'editor' | 'changes' | 'browser';
```

Update the `createSession` signature in the `SessionStore` interface (line 19):
```typescript
// Before:
  createSession(taskId: string, type: 'claude' | 'codex', label?: string, prompt?: string): Promise<string>;
// After:
  createSession(taskId: string, type: 'claude' | 'codex' | 'shell', label?: string, prompt?: string, shell?: string): Promise<string>;
```

Update the `createSession` implementation (line 45-51):
```typescript
// Before:
  async createSession(taskId, type, label, prompt) {
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, { taskId, type, label, prompt });
    const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
    get().addTab(taskId, tab);
    await useTaskStore.getState().fetchTasks();
    return sessionId;
  },
// After:
  async createSession(taskId, type, label, prompt, shell) {
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, { taskId, type, label, prompt, shell });
    const tab: Tab = { id: sessionId, type, label: label ?? `${type} session`, sessionId };
    get().addTab(taskId, tab);
    await useTaskStore.getState().fetchTasks();
    return sessionId;
  },
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: extend session store Tab type and createSession for shell"
```

### Task 5: Update TabBar to show shell options

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx` — add shell entries, fetch shells

- [ ] **Step 1: Update TabBar**

Update the imports (line 1-7):
```typescript
import { useMemo, useEffect, useState } from 'react';
import { cva } from 'class-variance-authority';
import type { Tab } from '@/stores/session-store';
import type { ShellInfo } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '@/hooks/useWebSocket';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { X, Plus, Terminal, Code, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
```

Update the tabVariants type to include `shell` (line 13):
```typescript
// Before:
      type: { claude: 'text-success', codex: 'text-warning', editor: 'text-muted-foreground', changes: 'text-muted-foreground', browser: 'text-muted-foreground' },
// After:
      type: { claude: 'text-success', codex: 'text-warning', shell: 'text-info', editor: 'text-muted-foreground', changes: 'text-muted-foreground', browser: 'text-muted-foreground' },
```

Update `TabBarProps` interface (line 48):
```typescript
// Before:
  onNewTab: (type: 'claude' | 'codex' | 'changes' | 'browser') => void;
// After:
  onNewTab: (type: 'claude' | 'codex' | 'changes' | 'browser' | 'shell', shellPath?: string) => void;
```

Update the `TabBar` component (lines 51-68):
```typescript
export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  const [shells, setShells] = useState<ShellInfo[]>([]);

  useEffect(() => {
    sendRequest<{ shells: ShellInfo[] }>(MSG.SHELLS_LIST, {}).then(
      (res) => setShells(res.shells),
      () => {},
    );
  }, []);

  return (
    <div className="px-2 py-0.5 bg-card flex gap-0.5 border-b border-border items-center">
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} onTabClick={onTabClick} onTabClose={onTabClose} />
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm"><Plus className="h-3 w-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onNewTab('claude')}><Terminal className="h-3.5 w-3.5 mr-2" />Claude Code</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('codex')}><Code className="h-3.5 w-3.5 mr-2" />Codex</DropdownMenuItem>
          {shells.length > 0 && <DropdownMenuSeparator />}
          {shells.map((shell) => (
            <DropdownMenuItem key={shell.path} onClick={() => onNewTab('shell', shell.path)}>
              <Terminal className="h-3.5 w-3.5 mr-2" />
              {shell.name.charAt(0).toUpperCase() + shell.name.slice(1)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onNewTab('changes')}><Code className="h-3.5 w-3.5 mr-2" />Changes</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewTab('browser')}><Globe className="h-3.5 w-3.5 mr-2" />Browser</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: show detected shells in tab bar dropdown"
```

### Task 6: Update TabContent and Workspace to handle shell type

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx:38-46` — add shell case
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:24-37` — handle shell in handleNewTab

- [ ] **Step 1: Update TabContent**

In `packages/ui/src/components/workspace/TabContent.tsx`, update the switch statement (lines 38-46):
```typescript
// Before:
        switch (tab.type) {
          case 'claude':
          case 'codex':
            label = `${tab.type} terminal`;
            // Terminal panes are always mounted but hidden when inactive
            // so PTY output is buffered and state is preserved across tab switches
            pane = tab.sessionId
              ? <TerminalPane sessionId={tab.sessionId} visible={isActive} />
              : <div className="p-3 text-muted-foreground">Session not found</div>;
            break;

// After:
        switch (tab.type) {
          case 'claude':
          case 'codex':
          case 'shell':
            label = `${tab.type} terminal`;
            // Terminal panes are always mounted but hidden when inactive
            // so PTY output is buffered and state is preserved across tab switches
            pane = tab.sessionId
              ? <TerminalPane sessionId={tab.sessionId} visible={isActive} />
              : <div className="p-3 text-muted-foreground">Session not found</div>;
            break;
```

- [ ] **Step 2: Update Workspace handleNewTab**

In `packages/ui/src/components/workspace/Workspace.tsx`, update the `handleNewTab` function and its type signature (lines 24-37):
```typescript
// Before:
  const handleNewTab = async (type: 'claude' | 'codex' | 'changes' | 'browser') => {
    if (type === 'browser') {
      addTab(task.id, { id: crypto.randomUUID(), type: 'browser', label: 'New Tab', url: 'about:blank' });
    } else if (type === 'changes') {
      const existingChangesTab = tabs.find((tab) => tab.type === 'changes');
      if (existingChangesTab) {
        setActiveTab(task.id, existingChangesTab.id);
        return;
      }
      addTab(task.id, { id: crypto.randomUUID(), type: 'changes', label: 'Changes' });
    } else {
      await createSession(task.id, type, undefined, task.description || undefined);
    }
  };

// After:
  const handleNewTab = async (type: 'claude' | 'codex' | 'changes' | 'browser' | 'shell', shellPath?: string) => {
    if (type === 'browser') {
      addTab(task.id, { id: crypto.randomUUID(), type: 'browser', label: 'New Tab', url: 'about:blank' });
    } else if (type === 'changes') {
      const existingChangesTab = tabs.find((tab) => tab.type === 'changes');
      if (existingChangesTab) {
        setActiveTab(task.id, existingChangesTab.id);
        return;
      }
      addTab(task.id, { id: crypto.randomUUID(), type: 'changes', label: 'Changes' });
    } else if (type === 'shell' && shellPath) {
      const shellName = shellPath.split('/').pop() ?? 'shell';
      await createSession(task.id, 'shell', shellName, undefined, shellPath);
    } else {
      await createSession(task.id, type, undefined, task.description || undefined);
    }
  };
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: handle shell type in TabContent and Workspace"
```

---

## Chunk 4: Verification

### Task 7: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build shared package**

```bash
cd packages/shared && bun run build
```
Expected: Successful build with no type errors.

- [ ] **Step 2: Build backend**

```bash
cd packages/backend && bun run build
```
Expected: Successful build with no type errors.

- [ ] **Step 3: Build UI**

```bash
cd packages/ui && bun run build
```
Expected: Successful build with no type errors.

- [ ] **Step 4: Verify /etc/shells detection manually**

```bash
cat /etc/shells
```
Confirm output includes paths like `/bin/bash`, `/bin/zsh`. The detector should pick these up.

- [ ] **Step 5: Test end-to-end**

1. Start the backend: `cd packages/backend && bun run dev`
2. Start the UI: `cd packages/ui && bun run dev`
3. Open the app, select a task
4. Click "+" dropdown — verify shell entries (Zsh, Bash, etc.) appear
5. Click a shell entry — verify a terminal tab opens with an interactive shell
6. Type commands in the shell — verify they work
7. Close the shell tab — verify cleanup works
