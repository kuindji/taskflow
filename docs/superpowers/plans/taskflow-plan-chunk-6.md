# Chunk 6: UI Panes — Terminal, Editor, Changes

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md) | Next: [Chunk 7 — UI Panels, Browser, Wiring & Polish](taskflow-plan-chunk-7.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three core workspace tab panes: terminal (xterm.js), code editor (Monaco), and git changes viewer.

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
