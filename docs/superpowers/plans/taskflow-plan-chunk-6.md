# Chunk 6: UI Panes — Terminal, Editor, Files, Changes, Browser, TaskInfo

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md)

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
import { useSessionStore } from '../../stores/session-store';
import { onEvent } from '../../hooks/useWebSocket';
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
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Send keystrokes to PTY
    term.onData((data) => {
      sendInput(sessionId, data);
    });

    // Resize PTY when terminal resizes
    term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows);
    });

    // Listen for PTY output
    const unsubscribe = onEvent(MSG.TERMINAL_OUTPUT, (payload) => {
      const event = payload as TerminalOutputEvent;
      if (event.sessionId === sessionId) {
        term.write(event.data);
      }
    });

    // Resize on window resize
    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unsubscribe();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, overflow: 'hidden' }}
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
import { useFileStore } from '../../stores/file-store';

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
    readFile(filePath).then((content) => {
      editor.setValue(content);
      setDirty(false);
      setLoading(false);
    });

    const changeDisposable = editor.onDidChangeModelContent(() => {
      setDirty(true);
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      await writeFile(filePath, editor.getValue());
      setDirty(false);
    });

    return () => {
      changeDisposable.dispose();
      editor.dispose();
    };
  }, [filePath]);

  return (
    <div style={{ flex: 1, position: 'relative' }}>
      {dirty && (
        <button
          onClick={async () => {
            if (!editorRef.current) return;
            await writeFile(filePath, editorRef.current.getValue());
            setDirty(false);
          }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            background: 'var(--bg-overlay)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 8px',
            color: 'var(--accent-blue)',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Save
        </button>
      )}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', zIndex: 1,
        }}>
          Loading...
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
import { useEffect, useState } from 'react';
import type { GitStatusResult, GitFileStatus } from '@taskflow/shared';
import { MSG } from '@taskflow/shared';
import { sendRequest } from '../../hooks/useWebSocket';

interface ChangesPaneProps {
  repoPath: string;
}

export function ChangesPane({ repoPath }: ChangesPaneProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>('');

  useEffect(() => {
    fetchStatus();
  }, [repoPath]);

  async function fetchStatus() {
    const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, { path: repoPath });
    setStatus(status);
  }

  async function showDiff(filePath: string) {
    setSelectedFile(filePath);
    const { diff } = await sendRequest<{ diff: string }>(MSG.GIT_DIFF_FILE, { repoPath, filePath });
    setDiff(diff);
  }

  async function revertFile(filePath: string) {
    await sendRequest(MSG.GIT_REVERT_FILE, { repoPath, filePath });
    await fetchStatus();
    if (selectedFile === filePath) {
      setSelectedFile(null);
      setDiff('');
    }
  }

  const statusColor = (s: GitFileStatus['status']) => {
    if (s === 'new' || s === 'untracked') return 'var(--accent-green)';
    if (s === 'modified') return 'var(--accent-yellow)';
    if (s === 'deleted') return 'var(--accent-red)';
    return 'var(--text-secondary)';
  };

  const statusPrefix = (s: GitFileStatus['status']) => {
    if (s === 'new' || s === 'untracked') return '+';
    if (s === 'modified') return 'M';
    if (s === 'deleted') return 'D';
    if (s === 'renamed') return 'R';
    return '?';
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* File list */}
      <div style={{
        padding: 8, borderBottom: '1px solid var(--border)',
        maxHeight: '40%', overflow: 'auto',
      }}>
        {status?.branch && (
          <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 6 }}>
            Branch: {status.branch}
          </div>
        )}
        {status?.files.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No changes</div>
        )}
        {status?.files.map((file) => (
          <div
            key={file.path}
            onClick={() => showDiff(file.path)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '3px 4px', cursor: 'pointer', fontSize: 11,
              background: selectedFile === file.path ? 'var(--bg-overlay)' : 'transparent',
              borderRadius: 3,
            }}
          >
            <span>
              <span style={{ color: statusColor(file.status), marginRight: 6 }}>
                {statusPrefix(file.status)}
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>{file.path}</span>
            </span>
            <span
              onClick={(e) => { e.stopPropagation(); revertFile(file.path); }}
              title="Revert"
              style={{ color: 'var(--accent-red)', cursor: 'pointer', fontSize: 10 }}
            >
              ↩
            </span>
          </div>
        ))}
      </div>

      {/* Diff view */}
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {diff ? (
          <pre style={{
            fontFamily: 'JetBrains Mono, Menlo, Monaco, monospace',
            fontSize: 11, lineHeight: 1.5, margin: 0, whiteSpace: 'pre-wrap',
          }}>
            {diff.split('\n').map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('+') ? 'var(--accent-green)'
                  : line.startsWith('-') ? 'var(--accent-red)'
                  : line.startsWith('@@') ? 'var(--accent-blue)'
                  : 'var(--text-secondary)',
              }}>
                {line}
              </div>
            ))}
          </pre>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {selectedFile ? 'Loading diff...' : 'Click a file to see its diff'}
          </div>
        )}
      </div>
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

- [ ] **Step 1: Implement BrowserPane**

File: `packages/ui/src/components/panes/BrowserPane.tsx`
```tsx
import { useState } from 'react';

interface BrowserPaneProps {
  initialUrl: string;
}

export function BrowserPane({ initialUrl }: BrowserPaneProps) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* URL bar */}
      <div style={{
        padding: '4px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        gap: 4,
      }}>
        <button
          onClick={() => {
            const wv = document.querySelector(`webview[data-url="${url}"]`) as any;
            wv?.goBack();
          }}
          style={{
            background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '2px 8px', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          ←
        </button>
        <button
          onClick={() => {
            const wv = document.querySelector(`webview[data-url="${url}"]`) as any;
            wv?.reload();
          }}
          style={{
            background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '2px 8px', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: 11,
          }}
        >
          ↻
        </button>
        <input
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setUrl(inputUrl); }}
          style={{
            flex: 1, background: 'var(--bg-overlay)', border: 'none',
            borderRadius: 3, padding: '3px 6px', color: 'var(--text-primary)',
            fontSize: 11, outline: 'none',
          }}
        />
      </div>

      {/* Webview */}
      <webview
        src={url}
        data-url={url}
        style={{ flex: 1 }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/BrowserPane.tsx
git commit -m "feat: add BrowserPane with URL bar and webview"
```

### Task 6.5: FileExplorer and FileTree

**Files:**
- Create: `packages/ui/src/components/panels/FileExplorer.tsx`
- Create: `packages/ui/src/components/panels/FileTree.tsx`

- [ ] **Step 1: Create FileTree**

File: `packages/ui/src/components/panels/FileTree.tsx`
```tsx
import { useState } from 'react';
import type { FileNode } from '@taskflow/shared';

interface FileTreeProps {
  node: FileNode;
  depth?: number;
  gitFiles?: Map<string, string>; // path -> status
  onFileClick: (path: string) => void;
}

export function FileTree({ node, depth = 0, gitFiles, onFileClick }: FileTreeProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const gitStatus = gitFiles?.get(node.path);
  const statusColor = gitStatus === 'new' || gitStatus === 'untracked'
    ? 'var(--accent-green)'
    : gitStatus === 'modified' ? 'var(--accent-yellow)'
    : gitStatus === 'deleted' ? 'var(--accent-red)'
    : 'var(--text-secondary)';

  if (node.type === 'file') {
    return (
      <div
        onClick={() => onFileClick(node.path)}
        style={{
          padding: '2px 8px',
          paddingLeft: depth * 12 + 8,
          cursor: 'pointer',
          fontSize: 11,
          color: statusColor,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={node.path}
      >
        {node.name}
      </div>
    );
  }

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '2px 8px',
          paddingLeft: depth * 12 + 8,
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--text-muted)',
          userSelect: 'none',
        }}
      >
        {expanded ? '▾' : '▸'} {node.name}
      </div>
      {expanded && node.children?.map((child) => (
        <FileTree
          key={child.path}
          node={child}
          depth={depth + 1}
          gitFiles={gitFiles}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create FileExplorer**

File: `packages/ui/src/components/panels/FileExplorer.tsx`
```tsx
import { useEffect, useMemo } from 'react';
import { useFileStore } from '../../stores/file-store';
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';
import { useSessionStore } from '../../stores/session-store';
import { useUIStore } from '../../stores/ui-store';
import { FileTree } from './FileTree';

export function FileExplorer() {
  const { tree, gitStatus, fetchTree, fetchGitStatus, watchPath } = useFileStore();
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { addTab } = useSessionStore();

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path
    : project?.path;

  useEffect(() => {
    if (workingDir) {
      fetchTree(workingDir);
      fetchGitStatus(workingDir);
      watchPath(workingDir);
    }
  }, [workingDir]);

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
    addTab(task.id, {
      id: `editor-${path}`,
      type: 'editor',
      label: path.split('/').pop() ?? path,
      filePath: path,
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '5px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Files
        </span>
        <span
          onClick={() => useUIStore.getState().toggleFileExplorer()}
          style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}
        >
          ✕
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {tree ? (
          <FileTree
            node={tree}
            gitFiles={gitFiles}
            onFileClick={handleFileClick}
          />
        ) : (
          <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>
            {workingDir ? 'Loading...' : 'Select a task'}
          </div>
        )}
      </div>
    </div>
  );
}
```

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
import { useTaskStore } from '../../stores/task-store';
import { useUIStore } from '../../stores/ui-store';

export function TaskInfoPanel() {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const { updateTask } = useTaskStore();

  if (!task) {
    return (
      <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 11 }}>
        Select a task
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '5px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Task Info
        </span>
        <span
          onClick={() => useUIStore.getState().toggleTaskInfo()}
          style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10 }}
        >
          ✕
        </span>
      </div>

      <div style={{ flex: 1, padding: 8, overflow: 'auto', fontSize: 11 }}>
        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Description
        </label>
        <textarea
          value={task.description}
          onChange={(e) => updateTask(task.id, { description: e.target.value })}
          rows={4}
          style={{
            width: '100%', marginTop: 4, marginBottom: 12,
            background: 'var(--bg-overlay)', border: 'none', borderRadius: 3,
            padding: 6, color: 'var(--text-secondary)', fontSize: 11,
            resize: 'vertical', outline: 'none',
          }}
        />

        {task.worktree.branch && (
          <>
            <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
              Branch
            </label>
            <div style={{ color: 'var(--accent-blue)', marginTop: 4, marginBottom: 12 }}>
              {task.worktree.branch}
            </div>
          </>
        )}

        {task.worktree.path && (
          <>
            <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
              Worktree
            </label>
            <div style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 12 }}>
              {task.worktree.path}
            </div>
          </>
        )}

        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Created
        </label>
        <div style={{ color: 'var(--text-secondary)', marginTop: 4, marginBottom: 12 }}>
          {new Date(task.createdAt).toLocaleString()}
        </div>

        <label style={{ color: 'var(--text-muted)', fontSize: 9, textTransform: 'uppercase' }}>
          Notes
        </label>
        <textarea
          value={task.notes}
          onChange={(e) => updateTask(task.id, { notes: e.target.value })}
          rows={6}
          placeholder="Add notes..."
          style={{
            width: '100%', marginTop: 4,
            background: 'var(--bg-overlay)', border: 'none', borderRadius: 3,
            padding: 6, color: 'var(--text-secondary)', fontSize: 11,
            resize: 'vertical', outline: 'none',
          }}
        />
      </div>
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
import type { Tab } from '../../stores/session-store';
import { TerminalPane } from '../panes/TerminalPane';
import { EditorPane } from '../panes/EditorPane';
import { ChangesPane } from '../panes/ChangesPane';
import { BrowserPane } from '../panes/BrowserPane';
import { useTaskStore } from '../../stores/task-store';
import { useProjectStore } from '../../stores/project-store';

interface TabContentProps {
  tab: Tab | undefined;
}

export function TabContent({ tab }: TabContentProps) {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));

  if (!tab) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-muted)',
      }}>
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
        : <div style={{ padding: 12, color: 'var(--text-muted)' }}>Session not found</div>;

    case 'editor':
      return tab.filePath
        ? <EditorPane filePath={tab.filePath} />
        : <div style={{ padding: 12, color: 'var(--text-muted)' }}>No file specified</div>;

    case 'changes':
      return <ChangesPane repoPath={workingDir} />;

    case 'browser':
      return <BrowserPane initialUrl={tab.url ?? 'http://localhost:3000'} />;

    default:
      return <div style={{ padding: 12, color: 'var(--text-muted)' }}>Unknown tab type</div>;
  }
}
```

- [ ] **Step 2: Update App.tsx with real components**

File: `packages/ui/src/App.tsx`
```tsx
import { WebSocketProvider } from './providers/WebSocketProvider';
import { AppShell } from './components/AppShell';
import { TaskSidebar } from './components/sidebar/TaskSidebar';
import { FileExplorer } from './components/panels/FileExplorer';
import { TaskInfoPanel } from './components/panels/TaskInfoPanel';
import { Workspace } from './components/workspace/Workspace';

export function App() {
  return (
    <WebSocketProvider>
      <AppShell
        sidebar={<TaskSidebar />}
        fileExplorer={<FileExplorer />}
        workspace={<Workspace />}
        taskInfo={<TaskInfoPanel />}
      />
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

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete v1 Taskflow implementation"
```
