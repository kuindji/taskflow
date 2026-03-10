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
import { readFile } from 'fs/promises';
import { join } from 'path';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;

const PORT_FILE = '/tmp/.taskflow-port';
const UI_DEV_SERVER_URL = process.env.TASKFLOW_UI_URL;
const BACKEND_ENTRY = UI_DEV_SERVER_URL
  ? join(__dirname, '..', '..', 'packages', 'backend', 'src', 'index.ts')
  : join(__dirname, '..', '..', 'packages', 'backend', 'dist', 'index.js');

async function startBackend(): Promise<number> {
  return new Promise((resolve, reject) => {
    backendProcess = spawn('bun', ['run', BACKEND_ENTRY], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    backendProcess.stdout?.on('data', async (data) => {
      const output = data.toString();
      console.log('[backend]', output.trim());

      if (output.includes('running on port')) {
        try {
          const portStr = await readFile(PORT_FILE, 'utf-8');
          const port = parseInt(portStr.trim());
          resolve(port);
        } catch {
          reject(new Error('Could not read backend port file'));
        }
      }
    });

    backendProcess.stderr?.on('data', (data) => {
      console.error('[backend error]', data.toString().trim());
    });

    backendProcess.on('error', reject);

    // Timeout after 10 seconds
    setTimeout(() => reject(new Error('Backend startup timeout')), 10000);
  });
}

function createWindow(port: number) {
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

  // In dev, load from Vite dev server; otherwise load the workspace build output.
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
    createWindow(backendPort);
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
  app.quit();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
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
interface TaskflowBridge {
  getBackendPort(): Promise<number>;
  selectProjectDirectory(): Promise<string | null>;
}

interface Window {
  taskflow?: TaskflowBridge;
}
```

- [ ] **Step 4: Build and verify Electron starts**

Run: `cd electron && bun run build`
Expected: dist/main.js and dist/preload.js created

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`
Expected: `packages/backend/dist/index.js` and `packages/ui/dist/index.html` exist for workspace-run Electron builds

- [ ] **Step 5: Commit**

```bash
git add electron/src/ packages/ui/src/env.d.ts
git commit -m "feat: implement Electron main process with backend lifecycle"
```
