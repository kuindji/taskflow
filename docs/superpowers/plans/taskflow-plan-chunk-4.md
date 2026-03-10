# Chunk 4: Electron Shell

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 3 — Backend Sessions, Files & Git](taskflow-plan-chunk-3.md) | Next: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md)

---

### Task 4.1: Electron main process

**Files:**
- Modify: `electron/src/main.ts`
- Modify: `electron/src/preload.ts`

- [ ] **Step 1: Implement main process**

File: `electron/src/main.ts`
```typescript
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { constants } from 'fs';
import { access, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;
let backendPortFile: string | null = null;

const UI_DEV_SERVER_URL = process.env.TASKFLOW_UI_URL;
const BACKEND_ENTRY = UI_DEV_SERVER_URL
  ? join(__dirname, '..', '..', 'packages', 'backend', 'src', 'index.ts')
  : join(__dirname, '..', '..', 'packages', 'backend', 'dist', 'index.js');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackendPort(portFile: string, timeoutMs: number = 10000): Promise<number> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(portFile, constants.F_OK);
      const portStr = await readFile(portFile, 'utf-8');
      const port = Number.parseInt(portStr.trim(), 10);

      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    } catch {
      // Keep polling until the backend writes a valid port number.
    }

    if (backendProcess && backendProcess.exitCode !== null) {
      throw new Error(`Backend exited before startup (code ${backendProcess.exitCode})`);
    }

    await delay(100);
  }

  throw new Error(`Backend startup timeout after ${timeoutMs}ms`);
}

async function cleanupBackendArtifacts(): Promise<void> {
  if (!backendPortFile) return;

  await rm(backendPortFile, { force: true });
  backendPortFile = null;
}

async function startBackend(): Promise<number> {
  backendPortFile = join(tmpdir(), `taskflow-port-${process.pid}-${Date.now()}`);

  backendProcess = spawn('bun', ['run', BACKEND_ENTRY], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TASKFLOW_PORT_FILE: backendPortFile,
    },
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log('[backend]', data.toString().trim());
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error('[backend error]', data.toString().trim());
  });

  return Promise.race([
    waitForBackendPort(backendPortFile),
    new Promise<never>((_, reject) => {
      backendProcess?.once('error', reject);
    }),
    new Promise<never>((_, reject) => {
      backendProcess?.once('exit', (code) => {
        reject(new Error(`Backend exited before startup (code ${code ?? 'unknown'})`));
      });
    }),
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // For BrowserPane
    },
  });

  // If TASKFLOW_UI_URL is set manually for renderer development, use it.
  // Otherwise load the built UI from the workspace.
  if (UI_DEV_SERVER_URL) {
    mainWindow.loadURL(UI_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '..', '..', 'packages', 'ui', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    backendPort = await startBackend();
    console.log(`Backend started on port ${backendPort}`);
    createWindow();
  } catch (err) {
    console.error('Failed to start backend:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  void cleanupBackendArtifacts();
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
  void cleanupBackendArtifacts();
});

// Expose backend port to renderer via IPC
ipcMain.handle('get-backend-port', () => backendPort);
ipcMain.handle('select-project-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});
```

- [ ] **Step 2: Implement preload script**

File: `electron/src/preload.ts`
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('taskflow', {
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  selectProjectDirectory: () => ipcRenderer.invoke('select-project-directory'),
});
```

- [ ] **Step 3: Add type declaration for the preload API**

File: `packages/ui/src/env.d.ts`
```typescript
/// <reference types="vite/client" />

interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

declare global {
  interface Window {
    taskflow?: TaskflowBridge;
  }
}

export {};
```

- [ ] **Step 4: Build and verify Electron starts**

Run: `cd electron && bun run build`
Expected: dist/main.js and dist/preload.js created

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`
Expected: `packages/backend/dist/index.js` and `packages/ui/dist/index.html` exist for workspace-run Electron builds

Run: `cd electron && bun run dev`
Expected: Electron starts against the built workspace artifacts with no Vite dev server required

Optional renderer-only live reload workflow:
- Terminal 1: `cd /Users/kuindji/Projects/taskflow/packages/ui && bun run dev`
- Terminal 2: `cd /Users/kuindji/Projects/taskflow/electron && TASKFLOW_UI_URL=http://localhost:5173 bunx electron .`

- [ ] **Step 5: Commit**

```bash
git add electron/src/ packages/ui/src/env.d.ts
git commit -m "feat: implement Electron main process with backend lifecycle"
```
