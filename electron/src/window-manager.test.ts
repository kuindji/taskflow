import { beforeEach, expect, mock, test } from "bun:test";

type Listener = (...args: unknown[]) => void;

const created: FakeWindow[] = [];

class FakeWindow {
    private listeners = new Map<string, Listener[]>();
    webContents = { on: () => undefined, send: () => undefined };
    constructor() {
        created.push(this);
    }
    on(event: string, listener: Listener): void {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    }
    emit(event: string): void {
        for (const listener of this.listeners.get(event) ?? []) listener();
    }
    getBounds() {
        return { x: 10, y: 20, width: 1000, height: 700 };
    }
    isMaximized() {
        return false;
    }
    isMinimized() {
        return false;
    }
    loadURL() {
        return Promise.resolve();
    }
    loadFile() {
        return Promise.resolve();
    }
    show() {}
    focus() {}
}

void mock.module("electron", () => ({
    app: { getAppPath: () => "/app", dock: { show: () => Promise.resolve(), hide: () => {} } },
    BrowserWindow: FakeWindow,
    screen: {},
}));
void mock.module("./browser-host", () => ({ detachAll: () => {} }));

const { initWindowManager, createWindow, getMainWindow, saveWindowState } =
    await import("./window-manager");

let requests: { path: string; init?: RequestInit }[];
let releaseSettings: () => void;

beforeEach(() => {
    created.length = 0;
    requests = [];
    const settingsGate = new Promise<void>((resolve) => {
        releaseSettings = resolve;
    });
    initWindowManager({
        backendFetch: async (_origin, path, init) => {
            requests.push({ path, init });
            if (!init?.method) await settingsGate;
            return new Response("{}");
        },
        getBackendPort: () => 4100,
        getUIDevServerURL: () => "http://localhost:5173",
        getUIPath: () => "/ui/index.html",
        onWindowClosed: () => {},
    });
});

test("overlapping opens share one window", async () => {
    const first = createWindow();
    const second = createWindow();
    releaseSettings();
    await Promise.all([first, second]);

    expect(created).toHaveLength(1);
    expect(Object.is(getMainWindow(), created[0])).toBe(true);

    created[0]?.emit("closed");
    expect(getMainWindow()).toBeNull();
});

test("window state can be saved before the window closes", async () => {
    const opened = createWindow();
    releaseSettings();
    await opened;

    await saveWindowState();

    const patch = requests.find((r) => r.init?.method === "PATCH");
    expect(patch?.path).toBe("/api/settings");
    const body = patch?.init?.body;
    expect(typeof body === "string" ? JSON.parse(body) : body).toEqual({
        layout: { window: { x: 10, y: 20, width: 1000, height: 700, isMaximized: false } },
    });

    created[0]?.emit("closed");
});
