# Chunk 6: UI Panes — Terminal, Editor, Files, Changes, Browser, TaskInfo

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all workspace panes and side panels, then wire them into the app for a complete UI.

**Architecture:** Each pane is a focused component rendering in the workspace tab area. Panes for terminal sessions use xterm.js, code editing uses Monaco. All components use Tailwind classes (no inline styles except documented exceptions) and compose shadcn primitives.

**Tech Stack:** React 19, xterm.js, Monaco editor, shadcn/ui, cva, Tailwind CSS 4, lucide-react

> **Depends on:** Chunk 5 (AppShell, stores, WebSocket, TabContent placeholder). All shadcn components from Chunk 4.5.

---

### Task 6.1: TerminalPane with xterm.js

**Files:**
- Create: `packages/ui/src/components/panes/TerminalPane.tsx`

- [ ] **Step 1: Implement TerminalPane**

File: `packages/ui/src/components/panes/TerminalPane.tsx`
```tsx
import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { useSessionStore } from '@/stores/session-store';
import { onEvent } from '@/hooks/useWebSocket';
import { MSG } from '@taskflow/shared';
import type { TerminalOutputEvent } from '@taskflow/shared';
import 'xterm/css/xterm.css';

interface TerminalPaneProps {
  sessionId: string;
}

export function TerminalPane({ sessionId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { sendInput, resizeTerminal } = useSessionStore();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
      },
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    // Send keystrokes to PTY
    term.onData((data) => {
      sendInput(sessionId, data);
    });

    // Resize PTY when terminal resizes
    term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows);
    });

    fit.fit();
    resizeTerminal(sessionId, term.cols, term.rows);

    termRef.current = term;
    fitRef.current = fit;

    // Listen for PTY output
    const unsubscribe = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
      const event = payload as TerminalOutputEvent;
      if (event.sessionId === sessionId) {
        term.write(event.data);
      }
    });

    // Resize on container resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId, resizeTerminal, sendInput]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden"
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: add TerminalPane with xterm.js and PTY integration"
```

### Task 6.2: EditorPane with Monaco

**Files:**
- Create: `packages/ui/src/components/panes/EditorPane.tsx`

- [ ] **Step 1: Implement EditorPane**

File: `packages/ui/src/components/panes/EditorPane.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import { useFileStore } from '@/stores/file-store';
import { Button } from '@/components/ui/button';

interface EditorPaneProps {
  filePath: string;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', sh: 'shell', bash: 'shell',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop() ?? '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

export function EditorPane({ filePath }: EditorPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const { readFile, writeFile } = useFileStore();
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      theme: 'vs-dark',
      language: getLanguage(filePath),
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
    });

    editorRef.current = editor;

    // Load file content
    void readFile(filePath).then((content) => {
      editor.setValue(content);
      setDirty(false);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to read file:', err);
      setLoading(false);
    });

    const changeDisposable = editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      try {
        await writeFile(filePath, editor.getValue());
        setDirty(false);
      } catch (err) {
        console.error('Failed to save file:', err);
      }
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
    };
  }, [filePath, readFile, writeFile]);

  return (
    <div className="flex-1 relative">
      {dirty && (
        <Button
          size="sm"
          className="absolute top-2 right-2 z-10"
          onClick={async () => {
            if (!editorRef.current) return;
            try {
              await writeFile(filePath, editorRef.current.getValue());
              setDirty(false);
            } catch (err) {
              console.error('Failed to save file:', err);
            }
          }}
        >
          Save
        </Button>
      )}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-[1]">
          Loading...
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/EditorPane.tsx
git commit -m "feat: add EditorPane with Monaco editor"
```

### Task 6.3: ChangesPane

**Files:**
- Create: `packages/ui/src/components/panes/ChangesPane.tsx`

- [ ] **Step 1: Implement ChangesPane**

File: `packages/ui/src/components/panes/ChangesPane.tsx`
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { cva } from 'class-variance-authority';
import type { GitStatusResult, GitFileStatus } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '@/hooks/useWebSocket';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const diffLineVariants = cva('font-mono text-xs leading-relaxed whitespace-pre-wrap', {
  variants: {
    type: {
      added: 'text-success',
      removed: 'text-destructive',
      hunk: 'text-accent',
      context: 'text-secondary-foreground',
    },
  },
  defaultVariants: {
    type: 'context',
  },
});

function getDiffLineType(line: string): 'added' | 'removed' | 'hunk' | 'context' {
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  if (line.startsWith('@@')) return 'hunk';
  return 'context';
}

function gitStatusToColorScheme(status: GitFileStatus['status']): BadgeProps['colorScheme'] {
  if (status === 'new' || status === 'untracked') return 'claude';
  if (status === 'modified') return 'codex';
  return undefined;
}

function statusPrefix(status: GitFileStatus['status']): string {
  if (status === 'new' || status === 'untracked') return '+';
  if (status === 'modified') return 'M';
  if (status === 'deleted') return 'D';
  if (status === 'renamed') return 'R';
  return '?';
}

interface FileStatusRowProps {
  file: GitFileStatus;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onRevert: (path: string) => void;
}

function FileStatusRow({ file, isSelected, onSelect, onRevert }: FileStatusRowProps) {
  const rowClasses = useMemo(
    () => cn(
      'flex justify-between items-center px-1 py-0.5 cursor-pointer rounded-sm text-[11px]',
      isSelected && 'bg-muted',
    ),
    [isSelected],
  );

  const badgeClasses = useMemo(
    () => cn(
      'text-[9px] px-1 py-0 font-mono',
      file.status === 'deleted' && 'text-destructive border-destructive/30',
    ),
    [file.status],
  );

  return (
    <div onClick={() => onSelect(file.path)} className={rowClasses}>
      <span className="flex items-center gap-1.5">
        <Badge
          variant="outline"
          colorScheme={gitStatusToColorScheme(file.status)}
          className={badgeClasses}
        >
          {statusPrefix(file.status)}
        </Badge>
        <span className="text-secondary-foreground">{file.path}</span>
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-5 w-5 text-destructive"
            onClick={(e) => { e.stopPropagation(); onRevert(file.path); }}
          >
            <Undo2 className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Revert file</TooltipContent>
      </Tooltip>
    </div>
  );
}

interface ChangesPaneProps {
  repoPath: string;
  className?: string;
}

export function ChangesPane({ repoPath, className }: ChangesPaneProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const diffRequestIdRef = useRef(0);

  const containerClasses = useMemo(
    () => cn("flex-1 flex flex-col overflow-hidden", className),
    [className],
  );

  useEffect(() => {
    setSelectedFile(null);
    setDiff(null);
    setDiffLoading(false);
    void fetchStatus();
  }, [repoPath]);

  async function fetchStatus() {
    try {
      const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path: repoPath });
      setStatus(status);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
    }
  }

  async function showDiff(filePath: string) {
    const requestId = ++diffRequestIdRef.current;
    setSelectedFile(filePath);
    setDiff(null);
    setDiffLoading(true);
    try {
      const { diff } = await sendRequest<{ diff: string }>(MSG.GIT_DIFF_FILE, { repoPath, filePath });
      if (requestId !== diffRequestIdRef.current) return;
      setDiff(diff);
    } catch (err) {
      if (requestId !== diffRequestIdRef.current) return;
      console.error('Failed to fetch diff:', err);
      setDiff(null);
    } finally {
      if (requestId === diffRequestIdRef.current) {
        setDiffLoading(false);
      }
    }
  }

  async function revertFile(filePath: string) {
    try {
      await sendRequest(MSG.GIT_REVERT_FILE, { repoPath, filePath });
      await fetchStatus();
      if (selectedFile === filePath) {
        setSelectedFile(null);
        setDiff(null);
        setDiffLoading(false);
      }
    } catch (err) {
      console.error('Failed to revert file:', err);
    }
  }

  return (
    <div className={containerClasses}>
      {/* File list */}
      <ScrollArea className="max-h-[40%] border-b border-border p-2">
        {status?.branch && (
          <div className="mb-1.5">
            <Badge variant="outline" className="text-[10px]">
              {status.branch}
            </Badge>
          </div>
        )}
        {status?.files.length === 0 && (
          <div className="text-muted-foreground text-xs">No changes</div>
        )}
        {status?.files.map((file) => (
          <FileStatusRow
            key={file.path}
            file={file}
            isSelected={file.path === selectedFile}
            onSelect={showDiff}
            onRevert={revertFile}
          />
        ))}
      </ScrollArea>

      {/* Diff view */}
      <ScrollArea className="flex-1 p-2">
        {diffLoading ? (
          <div className="text-muted-foreground text-xs">Loading diff...</div>
        ) : diff ? (
          <pre className="m-0">
            {diff.split('\n').map((line, i) => (
              <div key={i} className={diffLineVariants({ type: getDiffLineType(line) })}>
                {line}
              </div>
            ))}
          </pre>
        ) : selectedFile ? (
          <div className="text-muted-foreground text-xs">
            No textual diff available for this file
          </div>
        ) : (
          <div className="text-muted-foreground text-xs">
            Click a file to see its diff
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/ChangesPane.tsx
git commit -m "feat: add ChangesPane with diff viewer and per-file revert"
```

### Task 6.4: BrowserPane

**Files:**
- Create: `packages/ui/src/components/panes/BrowserPane.tsx`

- [ ] **Step 1: Add webview JSX type declaration**

The `<webview>` tag is Electron-specific and has no JSX type. Add to `packages/ui/src/env.d.ts` (which should exist from Chunk 4 and already include Vite + preload bridge typings):

```typescript
// Add to existing env.d.ts
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
      src?: string;
      'data-url'?: string;
    }, HTMLElement>;
  }
}
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
  const webviewRef = useRef<HTMLElement | null>(null);

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
          onClick={() => {
            const wv = webviewRef.current as any;
            wv?.goBack();
          }}
        >
          <ArrowLeft className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const wv = webviewRef.current as any;
            wv?.reload();
          }}
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
git commit -m "feat: add BrowserPane with URL bar and webview"
```

### Task 6.5: FileExplorer and FileTree

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

### Task 6.6: TaskInfoPanel

**Files:**
- Create: `packages/ui/src/components/panels/TaskInfoPanel.tsx`

- [ ] **Step 1: Implement TaskInfoPanel**

File: `packages/ui/src/components/panels/TaskInfoPanel.tsx`
```tsx
import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (!task) return;
    if (
      descriptionDraft === lastSavedRef.current.description &&
      notesDraft === lastSavedRef.current.notes
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
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
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [descriptionDraft, notesDraft, task, updateTask]);

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

### Task 6.7: Wire all panes into TabContent and App

**Files:**
- Modify: `packages/ui/src/components/workspace/TabContent.tsx`
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Update TabContent to render real panes**

File: `packages/ui/src/components/workspace/TabContent.tsx`
```tsx
import type { Tab } from '@/stores/session-store';
import { TerminalPane } from '@/components/panes/TerminalPane';
import { EditorPane } from '@/components/panes/EditorPane';
import { ChangesPane } from '@/components/panes/ChangesPane';
import { BrowserPane } from '@/components/panes/BrowserPane';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';

interface TabContentProps {
  tab: Tab | undefined;
}

export function TabContent({ tab }: TabContentProps) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  if (!tab) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        No active tab. Create a session with +
      </div>
    );
  }

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path : project?.path ?? '';

  switch (tab.type) {
    case 'claude':
    case 'codex':
      return tab.sessionId
        ? <TerminalPane sessionId={tab.sessionId} />
        : <div className="p-3 text-muted-foreground">Session not found</div>;

    case 'editor':
      return tab.filePath
        ? <EditorPane filePath={tab.filePath} />
        : <div className="p-3 text-muted-foreground">No file specified</div>;

    case 'changes':
      return <ChangesPane repoPath={workingDir} />;

    case 'browser':
      return <BrowserPane key={tab.id} initialUrl={tab.url ?? 'about:blank'} />;

    default:
      return <div className="p-3 text-muted-foreground">Unknown tab type</div>;
  }
}
```

- [ ] **Step 2: Update App.tsx with real components**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from '@/providers/WebSocketProvider';
import { AppShell } from '@/components/AppShell';
import { TaskSidebar } from '@/components/sidebar/TaskSidebar';
import { FileExplorer } from '@/components/panels/FileExplorer';
import { TaskInfoPanel } from '@/components/panels/TaskInfoPanel';
import { Workspace } from '@/components/workspace/Workspace';
import { TooltipProvider } from '@/components/ui/tooltip';

export function App() {
  return (
    <WebSocketProvider>
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

- [ ] **Step 3: Run typecheck on UI**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors (or only expected warnings for xterm/monaco type quirks)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/App.tsx
git commit -m "feat: wire all panes into TabContent and complete App assembly"
```

### Task 6.8: Final integration verify

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run UI typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No blocking errors

- [ ] **Step 3: Start backend and verify**

Run: `cd packages/backend && timeout 3 bun run src/index.ts || true`
Expected: Backend starts, detects editors

- [ ] **Step 4: Verify editor save + live refresh behavior**

Manual verify:
- Open an editor tab, modify a file, press `Cmd/Ctrl+S`, and confirm the content persists on disk.
- Modify a watched file externally and confirm the file tree and git status refresh.
- Close a Claude/Codex tab and confirm the PTY session exits.

- [ ] **Step 5: Final commit (if any uncommitted changes remain)**

```bash
git status
# If any files were modified during verification, stage them specifically:
# git add <specific-files>
# git commit -m "fix: address integration issues found during final verification"
```

Note: All code should already be committed by Tasks 6.1–6.7. This step is only needed if verification steps revealed issues that required fixes.
