# Chunk 7: UI Panels, Browser, Wiring & Polish

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 6 — UI Panes](taskflow-plan-chunk-6.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the browser pane, side panels (file explorer, task info), error boundary, then wire everything into the final app assembly.

**Architecture:** BrowserPane uses Electron's `<webview>` tag with proper typing. FileExplorer and TaskInfoPanel are collapsible side panels. An ErrorBoundary wraps each pane to prevent cascading crashes. All components use Tailwind classes and compose shadcn primitives.

**Tech Stack:** React 19, shadcn/ui, cva, Tailwind CSS 4, lucide-react

> **Depends on:** Chunk 6 (TerminalPane, EditorPane, ChangesPane). Chunk 5 (AppShell, stores, WebSocket, Workspace skeleton). All shadcn components from Chunk 4.5.

---

### Task 7.1: BrowserPane

**Files:**
- Modify: `packages/ui/src/env.d.ts`
- Create: `packages/ui/src/components/panes/BrowserPane.tsx`

- [ ] **Step 1: Update webview JSX type declaration**

The `<webview>` tag is Electron-specific and has no JSX type. Update `packages/ui/src/env.d.ts` (which should exist from Chunk 4 and already include Vite + preload bridge typings) to add webview with navigation methods:

File: `packages/ui/src/env.d.ts`
```typescript
/// <reference types="vite/client" />

interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

interface WebviewElement extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  canGoBack(): boolean;
}

declare global {
  interface Window {
    taskflow?: TaskflowBridge;
  }
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<WebviewElement> & {
      src?: string;
    }, WebviewElement>;
  }
}

export {};
```

- [ ] **Step 2: Implement BrowserPane**

File: `packages/ui/src/components/panes/BrowserPane.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RotateCw } from 'lucide-react';

interface BrowserPaneProps {
  initialUrl: string;
}

export function BrowserPane({ initialUrl }: BrowserPaneProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const webviewRef = useRef<WebviewElement | null>(null);

  useEffect(() => {
    setUrl(initialUrl);
    setInputUrl(initialUrl);
  }, [initialUrl]);

  return (
    <div className="flex-1 flex flex-col">
      {/* URL bar */}
      <div className="px-2 py-1 border-b border-border flex gap-1 items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => webviewRef.current?.reload()}
        >
          <RotateCw className="h-3 w-3" />
        </Button>
        <Input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setUrl(inputUrl); }}
          className="flex-1 h-7 text-xs"
        />
      </div>

      {/* Webview */}
      <webview
        ref={webviewRef}
        src={url}
        className="flex-1"
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panes/BrowserPane.tsx packages/ui/src/env.d.ts
git commit -m "feat: add BrowserPane with URL bar and typed webview"
```

### Task 7.2: FileExplorer and FileTree

**Files:**
- Create: `packages/ui/src/components/panels/FileExplorer.tsx`
- Create: `packages/ui/src/components/panels/FileTree.tsx`

- [ ] **Step 1: Create FileTree**

File: `packages/ui/src/components/panels/FileTree.tsx`
```tsx
import { useMemo, useState } from 'react';
import { cva } from 'class-variance-authority';
import type { FileNode } from '@taskflow/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const fileNodeVariants = cva(
  'text-xs whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer',
  {
    variants: {
      gitStatus: {
        new: 'text-success',
        untracked: 'text-success',
        modified: 'text-warning',
        deleted: 'text-destructive',
        renamed: 'text-accent',
        clean: 'text-secondary-foreground',
      },
    },
    defaultVariants: {
      gitStatus: 'clean',
    },
  },
);

interface FileTreeProps {
  node: FileNode;
  depth?: number;
  gitFiles?: Map<string, string>; // path -> status
  onFileClick: (path: string) => void;
  className?: string;
}

export function FileTree({ node, depth = 0, gitFiles, onFileClick, className }: FileTreeProps) {
  const [open, setOpen] = useState(depth < 2);
  const gitStatus = (gitFiles?.get(node.path) ?? 'clean') as
    'new' | 'untracked' | 'modified' | 'deleted' | 'renamed' | 'clean';

  const fileClasses = useMemo(
    () => cn(fileNodeVariants({ gitStatus }), 'py-0.5 px-2 hover:bg-muted/50'),
    [gitStatus],
  );

  if (node.type === 'file') {
    return (
      <div
        onClick={() => onFileClick(node.path)}
        className={fileClasses}
        style={{ paddingLeft: depth * 12 + 8 }}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="w-full py-0.5 px-2 text-xs text-muted-foreground cursor-pointer select-none hover:bg-muted/50 flex items-center"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        <span className="mr-1 text-[10px]">{open ? '▾' : '▸'}</span>
        {node.name}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {node.children?.map((child) => (
          <FileTree
            key={child.path}
            node={child}
            depth={depth + 1}
            gitFiles={gitFiles}
            onFileClick={onFileClick}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

Note: `style={{ paddingLeft }}` is an inline style exception — tree depth is a dynamic calculation that can't be expressed as a Tailwind variant.

- [ ] **Step 2: Create FileExplorer**

File: `packages/ui/src/components/panels/FileExplorer.tsx`
```tsx
import { useEffect, useMemo } from 'react';
import { useFileStore } from '@/stores/file-store';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { X } from 'lucide-react';
import { FileTree } from './FileTree';

export function FileExplorer() {
  const { tree, gitStatus, fetchTree, fetchGitStatus, watchPath, unwatchPath } = useFileStore();
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { addTab, getTabs, setActiveTab } = useSessionStore();

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path
    : project?.path;

  useEffect(() => {
    if (!workingDir) return;

    void fetchTree(workingDir);
    void fetchGitStatus(workingDir);
    void watchPath(workingDir);

    return () => {
      void unwatchPath(workingDir);
    };
  }, [workingDir, fetchTree, fetchGitStatus, watchPath, unwatchPath]);

  const gitFiles = useMemo(() => {
    const map = new Map<string, string>();
    gitStatus?.files.forEach((f) => {
      const absolutePath = f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
      map.set(absolutePath, f.status);
    });
    return map;
  }, [gitStatus, workingDir]);

  const handleFileClick = (path: string) => {
    if (!task) return;

    const existingTab = getTabs(task.id).find((tab) => tab.type === 'editor' && tab.filePath === path);
    if (existingTab) {
      setActiveTab(task.id, existingTab.id);
      return;
    }

    addTab(task.id, {
      id: crypto.randomUUID(),
      type: 'editor',
      label: path.split('/').pop() ?? path,
      filePath: path,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 flex justify-between items-center">
        <span className="text-muted-foreground text-[9px] uppercase tracking-wider">
          Files
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useUIStore.getState().toggleFileExplorer()}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1 py-1">
        {tree ? (
          <FileTree
            node={tree}
            gitFiles={gitFiles}
            onFileClick={handleFileClick}
          />
        ) : (
          <div className="p-2 text-muted-foreground text-[11px]">
            {workingDir ? 'Loading...' : 'Select a task'}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
```

Note: Clicking a file that already has an open editor tab should focus that existing tab instead of creating a duplicate tab.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panels/FileExplorer.tsx packages/ui/src/components/panels/FileTree.tsx
git commit -m "feat: add FileExplorer and FileTree with git status"
```

### Task 7.3: TaskInfoPanel

**Files:**
- Create: `packages/ui/src/components/panels/TaskInfoPanel.tsx`

- [ ] **Step 1: Implement TaskInfoPanel**

File: `packages/ui/src/components/panels/TaskInfoPanel.tsx`
```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '@/stores/task-store';
import { useUIStore } from '@/stores/ui-store';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X } from 'lucide-react';

export function TaskInfoPanel({ className }: { className?: string }) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const { updateTask } = useTaskStore();
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const lastSavedRef = useRef({ description: '', notes: '' });

  useEffect(() => {
    if (!task) return;
    setDescriptionDraft(task.description);
    setNotesDraft(task.notes);
    lastSavedRef.current = {
      description: task.description,
      notes: task.notes,
    };
  }, [task?.id]);

  const saveIfDirty = useCallback(() => {
    if (!task) return;
    const updates: { description?: string; notes?: string } = {};
    if (descriptionDraft !== lastSavedRef.current.description) {
      updates.description = descriptionDraft;
    }
    if (notesDraft !== lastSavedRef.current.notes) {
      updates.notes = notesDraft;
    }
    if (Object.keys(updates).length === 0) return;

    lastSavedRef.current = {
      description: descriptionDraft,
      notes: notesDraft,
    };

    void updateTask(task.id, updates).catch((err) => {
      console.error('Failed to update task:', err);
    });
  }, [task, descriptionDraft, notesDraft, updateTask]);

  // Auto-save on debounce
  useEffect(() => {
    if (!task) return;
    if (
      descriptionDraft === lastSavedRef.current.description &&
      notesDraft === lastSavedRef.current.notes
    ) {
      return;
    }

    const timeoutId = window.setTimeout(saveIfDirty, 400);
    return () => window.clearTimeout(timeoutId);
  }, [descriptionDraft, notesDraft, task, saveIfDirty]);

  // Flush unsaved changes on unmount
  useEffect(() => {
    return () => { saveIfDirty(); };
  }, [saveIfDirty]);

  if (!task) {
    return (
      <div className="p-2 text-muted-foreground text-[11px]">
        Select a task
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 flex justify-between items-center">
        <span className="text-muted-foreground text-[9px] uppercase tracking-wider">
          Task Info
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useUIStore.getState().toggleTaskInfo()}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Separator />

      <ScrollArea className="flex-1 p-2">
        <div className="space-y-3">
          {/* Description */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Description
            </label>
            <Textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              rows={4}
              className="mt-1 text-[11px]"
            />
          </div>

          <Separator className="my-3" />

          {/* Branch */}
          {task.worktree.branch && (
            <div>
              <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Branch
              </label>
              <div className="mt-1">
                <Badge variant="outline" colorScheme="active">
                  {task.worktree.branch}
                </Badge>
              </div>
            </div>
          )}

          {/* Worktree */}
          {task.worktree.path && (
            <div>
              <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Worktree
              </label>
              <div className="mt-1 text-secondary-foreground text-[11px]">
                {task.worktree.path}
              </div>
            </div>
          )}

          <Separator className="my-3" />

          {/* Created */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Created
            </label>
            <div className="mt-1 text-secondary-foreground text-[11px]">
              {new Date(task.createdAt).toLocaleString()}
            </div>
          </div>

          <Separator className="my-3" />

          {/* Notes */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Notes
            </label>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={6}
              placeholder="Add notes..."
              className="mt-1 text-[11px]"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panels/TaskInfoPanel.tsx
git commit -m "feat: add TaskInfoPanel with editable description and notes"
```

### Task 7.4: Error boundary

**Files:**
- Create: `packages/ui/src/components/ErrorBoundary.tsx`

- [ ] **Step 1: Implement ErrorBoundary**

File: `packages/ui/src/components/ErrorBoundary.tsx`
```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackLabel?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`ErrorBoundary caught error in ${this.props.fallbackLabel ?? 'component'}:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="text-destructive text-sm font-medium">
            {this.props.fallbackLabel ?? 'This pane'} crashed
          </div>
          <div className="text-muted-foreground text-xs max-w-md break-words">
            {this.state.error?.message ?? 'Unknown error'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ErrorBoundary.tsx
git commit -m "feat: add ErrorBoundary component for pane isolation"
```

### Task 7.5: Wire all panes into TabContent and App

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Update TabContent to render real panes with error boundaries**

File: `packages/ui/src/components/workspace/TabContent.tsx`
```tsx
import type { Tab } from '@/stores/session-store';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { TerminalPane } from '@/components/panes/TerminalPane';
import { EditorPane } from '@/components/panes/EditorPane';
import { ChangesPane } from '@/components/panes/ChangesPane';
import { BrowserPane } from '@/components/panes/BrowserPane';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';

interface TabContentProps {
  tabs: Tab[];
  activeTabId: string;
}

export function TabContent({ tabs, activeTabId }: TabContentProps) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No active tab. Create a session with +
      </div>
    );
  }

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path : project?.path ?? '';

  return (
    <>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        let pane: React.ReactNode;
        let label: string;

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

          case 'editor':
            label = tab.filePath?.split('/').pop() ?? 'Editor';
            if (!isActive) return null; // Editors are mounted/unmounted normally
            pane = tab.filePath
              ? <EditorPane filePath={tab.filePath} />
              : <div className="p-3 text-muted-foreground">No file specified</div>;
            break;

          case 'changes':
            label = 'Changes';
            if (!isActive) return null;
            pane = <ChangesPane repoPath={workingDir} />;
            break;

          case 'browser':
            label = 'Browser';
            if (!isActive) return null;
            pane = <BrowserPane key={tab.id} initialUrl={tab.url ?? 'about:blank'} />;
            break;

          default:
            return null;
        }

        return (
          <ErrorBoundary key={tab.id} fallbackLabel={label}>
            <div style={{ display: isActive ? 'contents' : 'none' }}>
              {pane}
            </div>
          </ErrorBoundary>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Update App.tsx with real components**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider, useWsStatus } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';
import { DialogHost } from '@/components/DialogHost';
import { TaskSidebar } from '@/components/sidebar/TaskSidebar';
import { FileExplorer } from '@/components/panels/FileExplorer';
import { TaskInfoPanel } from '@/components/panels/TaskInfoPanel';
import { Workspace } from '@/components/workspace/Workspace';
import { TooltipProvider } from '@/components/ui/tooltip';

function ConnectionOverlay() {
  const { connected, error } = useWsStatus();
  if (connected) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="text-center space-y-2">
        <div className="text-foreground text-sm font-medium">
          {error ? 'Connection Failed' : 'Connecting to backend...'}
        </div>
        {error && <div className="text-destructive text-xs">{error}</div>}
        {!error && (
          <div className="text-muted-foreground text-xs">Reconnecting...</div>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <WebSocketProvider>
      <ConnectionOverlay />
      <DialogHost />
      <TooltipProvider>
        <AppShell
          sidebar={<TaskSidebar />}
          fileExplorer={<FileExplorer />}
          workspace={<Workspace />}
          taskInfo={<TaskInfoPanel />}
        />
      </TooltipProvider>
    </WebSocketProvider>
  );
}
```

Note: `<ConnectionOverlay>` shows a backdrop when the WebSocket disconnects and auto-hides on reconnect.

- [ ] **Step 3: Run typecheck on UI**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors (or only expected warnings for xterm/monaco type quirks)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/App.tsx
git commit -m "feat: wire all panes into TabContent with error boundaries and complete App"
```

### Task 7.6: Final integration verify

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run UI typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No blocking errors

- [ ] **Step 3: Start backend and verify**

Run: `cd packages/backend && log_file="$(mktemp -t taskflow-backend.XXXXXX)" && bun run src/index.ts >"$log_file" 2>&1 & pid=$! && sleep 3 && kill "$pid" 2>/dev/null && wait "$pid" 2>/dev/null || true && cat "$log_file"`
Expected: Backend starts, detects editors

- [ ] **Step 4: Verify editor save + live refresh behavior**

Manual verify:
- Open an editor tab, modify a file, press `Cmd/Ctrl+S`, and confirm the content persists on disk.
- Modify a watched file externally and confirm the file tree and git status refresh.
- Close a Claude/Codex tab and confirm the PTY session exits.
- Force an error in a pane (e.g., open a non-existent file) and confirm the error boundary catches it without crashing the app.

- [ ] **Step 5: Final commit (if any uncommitted changes remain)**

```bash
git status
# If any files were modified during verification, stage them specifically:
# git add <specific-files>
# git commit -m "fix: address integration issues found during final verification"
```

Note: All code should already be committed by Tasks 7.1–7.5. This step is only needed if verification steps revealed issues that required fixes.
