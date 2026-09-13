import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "child_process";
import { copyFile, writeFile } from "fs/promises";
import { join } from "path";
import type { TunnelFailure } from "@taskflow/shared";
import type { BackendRegistry } from "./backend-registry";
import { backendOrigin } from "./backend-url";
import type { TrayState } from "./tray-manager";
import { onTunnelExit } from "./tunnel-manager";

/**
 * The backend this app started. It is not a saved record, so the backend IPC
 * channels answer for it here and the renderer attaches, detaches and handshakes
 * it through the same calls as any other machine.
 */
const LOCAL_BACKEND_ID = "local";

interface IpcHandlersDeps {
    getMainWindow: () => BrowserWindow | null;
    getBackendPort: () => number | null;
    registry: BackendRegistry;
    setRendererTrayState: (status: TrayState) => void;
    updateTrayIcon: () => void;
    setShowArchiveChecked: (value: boolean) => void;
    setShowArchivedProjectsChecked: (value: boolean) => void;
    setCompactSidebarChecked: (value: boolean) => void;
    setFileExplorerChecked: (value: boolean) => void;
    setTaskInfoChecked: (value: boolean) => void;
    setWordWrapChecked: (value: boolean) => void;
    setConfirmBeforeExit: (value: boolean) => void;
    markExitConfirmed: () => void;
}

interface NativeMenuItem {
    id?: string;
    label?: string;
    enabled?: boolean;
    checked?: boolean;
    type?: "normal" | "separator" | "submenu" | "checkbox" | "label";
    submenu?: NativeMenuItem[];
}

interface NativeMenuPosition {
    x: number;
    y: number;
}

function buildNativeMenuTemplate(
    items: NativeMenuItem[],
    resolveSelection: (id: string | null) => void,
): Electron.MenuItemConstructorOptions[] {
    return items.map((item) => {
        if (item.type === "separator") {
            return { type: "separator" };
        }

        if (item.type === "submenu") {
            return {
                label: item.label ?? "",
                enabled: item.enabled !== false,
                submenu: buildNativeMenuTemplate(item.submenu ?? [], resolveSelection),
            };
        }

        if (item.type === "label") {
            return {
                label: item.label ?? "",
                enabled: false,
            };
        }

        return {
            type: item.type === "checkbox" ? "checkbox" : "normal",
            label: item.label ?? "",
            enabled: item.enabled !== false,
            checked: item.type === "checkbox" ? !!item.checked : undefined,
            click: () => resolveSelection(item.id ?? null),
        };
    });
}

function registerIpcHandlers(deps: IpcHandlersDeps): void {
    ipcMain.handle("get-backend-port", () => deps.getBackendPort());

    ipcMain.handle("open-external-url", (_event, url: string) => {
        if (!url.startsWith("https://") && !url.startsWith("http://")) return;
        return shell.openExternal(url);
    });

    ipcMain.on("tray-state-changed", (_event, status: TrayState) => {
        deps.setRendererTrayState(status);
    });

    nativeTheme.on("updated", () => {
        deps.updateTrayIcon();
    });

    ipcMain.handle("get-window-fullscreen", (event) => {
        const senderWindow =
            BrowserWindow.fromWebContents(event.sender) ??
            BrowserWindow.getFocusedWindow() ??
            deps.getMainWindow();
        return senderWindow?.isFullScreen() ?? false;
    });

    ipcMain.on("show-item-in-folder", (_event, filePath: string) => {
        if (!filePath.startsWith("/") || filePath.includes("..")) return;
        shell.showItemInFolder(filePath);
    });

    ipcMain.handle(
        "save-artifact",
        async (
            _event,
            opts: { path?: string; text?: string; defaultName?: string },
        ): Promise<{ success: boolean; error?: string }> => {
            const defaultPath = opts.defaultName
                ? join(app.getPath("downloads"), opts.defaultName)
                : undefined;
            const mainWindow = deps.getMainWindow();
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            const result = win
                ? await dialog.showSaveDialog(win, { defaultPath })
                : await dialog.showSaveDialog({ defaultPath });
            if (result.canceled || !result.filePath) return { success: false };
            try {
                if (typeof opts.path === "string") {
                    if (!opts.path.startsWith("/") || opts.path.includes(".."))
                        return { success: false, error: "Invalid source path" };
                    await copyFile(opts.path, result.filePath);
                } else if (typeof opts.text === "string") {
                    await writeFile(result.filePath, opts.text, "utf-8");
                } else {
                    return { success: false, error: "No path or text provided" };
                }
                return { success: true };
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                await dialog.showMessageBox({
                    type: "error",
                    title: "Download failed",
                    message: `Could not save the artifact:\n${message}`,
                });
                return { success: false, error: message };
            }
        },
    );

    ipcMain.handle(
        "open-external-file",
        (_event, filePath: string, opts?: { line?: number; col?: number; editor?: string }) => {
            if (!filePath.startsWith("/") || filePath.includes("..")) return "";
            const editor = opts?.editor ?? "system";
            if (editor === "system") return shell.openPath(filePath);

            const line = opts?.line;
            const col = opts?.col;

            const editorCommands: Record<string, () => string[]> = {
                vscode: () => ["code", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
                cursor: () => ["cursor", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
                windsurf: () => ["windsurf", "--goto", `${filePath}:${line ?? 1}:${col ?? 1}`],
                zed: () => ["zed", `${filePath}:${line ?? 1}:${col ?? 1}`],
                sublime: () => ["subl", `${filePath}:${line ?? 1}:${col ?? 1}`],
                webstorm: () => [
                    "webstorm",
                    ...(line != null ? ["--line", String(line)] : []),
                    ...(col != null ? ["--column", String(col)] : []),
                    filePath,
                ],
                idea: () => [
                    "idea",
                    ...(line != null ? ["--line", String(line)] : []),
                    ...(col != null ? ["--column", String(col)] : []),
                    filePath,
                ],
            };

            const buildArgs = editorCommands[editor];
            if (!buildArgs) return shell.openPath(filePath);

            const [cmd, ...args] = buildArgs();
            return new Promise<string>((resolve) => {
                execFile(cmd, args, { timeout: 5000 }, (err) => {
                    if (err) {
                        void shell.openPath(filePath).then(resolve);
                    } else {
                        resolve("");
                    }
                });
            });
        },
    );

    ipcMain.on("quit-and-install-update", () => {
        deps.markExitConfirmed();
        autoUpdater.quitAndInstall();
    });

    ipcMain.handle("select-project-directory", async () => {
        const result = await dialog.showOpenDialog({
            properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled) return null;
        return result.filePaths[0] ?? null;
    });

    ipcMain.handle("select-theme-file", async () => {
        const result = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [
                {
                    name: "Theme Files",
                    extensions: ["json", "toml", "yaml", "yml", "conf", "plist", "terminal"],
                },
                { name: "All Files", extensions: ["*"] },
            ],
        });
        if (result.canceled) return null;
        return result.filePaths[0] ?? null;
    });

    ipcMain.handle("select-file", async () => {
        const mainWindow = deps.getMainWindow();
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
        if (!win) return null;
        const result = await dialog.showOpenDialog(win, {
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    });

    ipcMain.handle(
        "show-native-menu",
        async (
            event,
            items: NativeMenuItem[],
            position: NativeMenuPosition,
        ): Promise<string | null> => {
            const senderWindow =
                BrowserWindow.fromWebContents(event.sender) ??
                BrowserWindow.getFocusedWindow() ??
                deps.getMainWindow();
            if (!senderWindow) return null;

            return await new Promise<string | null>((resolve) => {
                let settled = false;
                const resolveSelection = (id: string | null) => {
                    if (settled) return;
                    settled = true;
                    resolve(id);
                };

                const menu = Menu.buildFromTemplate(
                    buildNativeMenuTemplate(items, resolveSelection),
                );

                menu.popup({
                    window: senderWindow,
                    x: Number.isFinite(position?.x) ? Math.round(position.x) : undefined,
                    y: Number.isFinite(position?.y) ? Math.round(position.y) : undefined,
                    callback: () => resolveSelection(null),
                });
            });
        },
    );

    ipcMain.on("archive-state-changed", (_event, showArchive: boolean) => {
        deps.setShowArchiveChecked(showArchive);
    });

    ipcMain.on("archived-projects-state-changed", (_event, showArchivedProjects: boolean) => {
        deps.setShowArchivedProjectsChecked(showArchivedProjects);
    });

    ipcMain.on("compact-sidebar-changed", (_event, compact: boolean) => {
        deps.setCompactSidebarChecked(compact);
    });

    ipcMain.on("file-explorer-state-changed", (_event, open: boolean) => {
        deps.setFileExplorerChecked(open);
    });

    ipcMain.on("task-info-state-changed", (_event, open: boolean) => {
        deps.setTaskInfoChecked(open);
    });

    ipcMain.on("word-wrap-state-changed", (_event, enabled: boolean) => {
        deps.setWordWrapChecked(enabled);
    });

    ipcMain.on("confirm-before-exit-changed", (_event, enabled: boolean) => {
        deps.setConfirmBeforeExit(enabled);
    });

    registerBackendHandlers(deps);
}

function registerBackendHandlers(deps: IpcHandlersDeps): void {
    const { registry } = deps;

    function localOrigin(): string | null {
        const port = deps.getBackendPort();
        return port === null ? null : backendOrigin(port);
    }

    ipcMain.handle("list-backends", () => registry.listBackends());

    ipcMain.handle("get-attached-backends", () => {
        const origin = localOrigin();
        const local = origin === null ? [] : [{ id: LOCAL_BACKEND_ID, origin, isLocal: true }];
        return [...local, ...registry.attached().map((entry) => ({ ...entry, isLocal: false }))];
    });

    ipcMain.handle("attach-backend", (_event, id: string) => {
        if (id !== LOCAL_BACKEND_ID) return registry.attachBackend(id);
        const origin = localOrigin();
        if (origin === null) {
            const failure: TunnelFailure = {
                kind: "no-backend",
                message: "The local backend is not running.",
                stderr: "",
            };
            return { ok: false, failure };
        }
        return { ok: true, origin };
    });

    ipcMain.handle("detach-backend", (_event, id: string) => {
        if (id === LOCAL_BACKEND_ID) return;
        return registry.detachBackend(id);
    });

    ipcMain.handle(
        "confirm-backend",
        (_event, id: string, info: { backendUid: string; protocolVersion: number }) => {
            // Local is not a record. Letting the registry answer would report a
            // rename onto local's uid, and the renderer would refile its local row.
            if (id === LOCAL_BACKEND_ID) return { id: LOCAL_BACKEND_ID, merged: false };
            // A remote backend reporting "local" as its uid would be refiled onto
            // the local row's id.
            if (info.backendUid === LOCAL_BACKEND_ID) {
                throw new Error(`"${LOCAL_BACKEND_ID}" is not a valid backend uid.`);
            }
            return registry.confirmBackend(id, info);
        },
    );

    ipcMain.handle("probe-backends", () => registry.probe());

    ipcMain.handle(
        "add-backend",
        (
            _event,
            input: {
                host: string;
                user?: string;
                sshPort?: number;
                port?: number;
                instanceId?: string;
            },
        ) => registry.addBackend(input),
    );

    ipcMain.handle("add-discovered-backend", (_event, entryId: string) =>
        registry.addDiscoveredBackend(entryId),
    );

    ipcMain.handle(
        "update-backend",
        (_event, id: string, patch: { displayName?: string; user?: string; sshPort?: number }) =>
            registry.updateBackend(id, patch),
    );

    ipcMain.handle("remove-backend", (_event, id: string) => registry.removeBackend(id));

    ipcMain.handle("trust-backend-host", (_event, id: string) => registry.trustBackendHost(id));

    ipcMain.handle("get-host-fingerprint", (_event, id: string) => registry.getHostFingerprint(id));

    ipcMain.handle("attached-record-ids", () => registry.attachedRecordIds());

    registry.onChanged(() => {
        deps.getMainWindow()?.webContents.send("backends-changed");
    });

    registry.onSeen((id) => {
        deps.getMainWindow()?.webContents.send("backend-seen", { id });
    });

    onTunnelExit((id, failure) => {
        void registry.tunnelExited(id);
        deps.getMainWindow()?.webContents.send("backend-dropped", { id, failure });
    });
}

export { registerIpcHandlers };
