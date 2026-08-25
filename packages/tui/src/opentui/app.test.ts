import { afterEach, describe, expect, it } from "bun:test";
import { BoxRenderable, type CliRenderer } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type {
    AppSettings,
    Project,
    SessionCreatePayload,
    SessionRef,
    Task,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { FlowStore } from "../flows/store";
import { ScheduleStore } from "../schedules/store";
import type { SessionOwner } from "../sessions/owner";
import { OpenTuiApp, cleanLabel, type SessionBridgeLike, type StoreLike } from "./app";

class FakeNet implements NetLike {
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statuses = new Set<(status: { connected: boolean }) => void>();
    clients = 1;
    readonly requests: Array<{ type: string; payload: unknown }> = [];
    readonly responses = new Map<string, unknown>();

    async request<T>(type: string, payload?: unknown): Promise<T> {
        this.requests.push({ type, payload });
        if (type === MSG.SYSTEM_CLIENTS) return { count: this.clients } as T;
        if (this.responses.has(type)) return this.responses.get(type) as T;
        throw new Error(`Unexpected request: ${type}`);
    }

    on(type: string, handler: (payload: unknown) => void): () => void {
        const listeners = this.handlers.get(type) ?? new Set();
        listeners.add(handler);
        this.handlers.set(type, listeners);
        return () => listeners.delete(handler);
    }

    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        this.statuses.add(listener);
        return () => this.statuses.delete(listener);
    }

    emit(type: string, payload: unknown): void {
        for (const handler of this.handlers.get(type) ?? []) handler(payload);
    }

    emitStatus(connected: boolean): void {
        for (const listener of this.statuses) listener({ connected });
    }
}

class FakeStore implements StoreLike {
    masterSessions: SessionRef[] = [];
    projects: Project[] = [];
    tasks: Task[] = [];
    private readonly listeners = new Set<() => void>();

    async load(): Promise<void> {}
    tasksFor(projectId: string): Task[] {
        return this.tasks.filter(
            (task) => task.projectId === projectId && task.status === "active",
        );
    }
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify(): void {
        for (const listener of this.listeners) listener();
    }
}

function project(id: string, name: string, sessions = 0): Project {
    return {
        id,
        name,
        path: `/tmp/${id}`,
        sessions: Array.from({ length: sessions }, (_, index) => ({
            id: `${id}-s${String(index)}`,
            type: "shell",
            label: "shell",
            createdAt: "now",
        })),
        attributes: [],
        createdAt: "now",
    };
}

function task(id: string, projectId: string, title: string, sessions = 0): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: Array.from({ length: sessions }, (_, index) => ({
            id: `${id}-s${String(index)}`,
            type: "shell",
            label: "shell",
            createdAt: "now",
        })),
        attributes: [],
        createdAt: "now",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function fakeBridge(renderer: CliRenderer, label: string) {
    const renderable = new BoxRenderable(renderer, { width: "100%", height: "100%" });
    const calls: string[] = [];
    const bridge = {
        renderable,
        attach: async () => {},
        setActive: (active: boolean, cols?: number, rows?: number) =>
            calls.push(`${String(active)}:${String(cols)}x${String(rows)}`),
        focus: () => calls.push("focus"),
        blur: () => calls.push("blur"),
        destroy: () => renderable.destroy(),
    } as unknown as SessionBridgeLike;
    return { id: label, label, bridge, calls };
}

describe("OpenTuiApp", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    async function setup(
        width = 80,
        height = 24,
        withSessions = false,
        onCreate?: (owner: SessionOwner, payload: SessionCreatePayload) => Promise<string>,
        onClose?: (sessionId: string) => Promise<void>,
        onResume?: (sessionId: string, cols: number, rows: number) => Promise<void>,
    ) {
        const test = await createTestRenderer({ width, height, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.AGENTS_LIST, {
            agents: [
                { type: "codex", available: true, path: "/codex", version: "1" },
                { type: "claude", available: false, path: "", version: "" },
            ],
        });
        net.responses.set(MSG.SHELLS_LIST, {
            shells: [{ name: "zsh", path: "/bin/zsh" }],
            systemShellPath: "/bin/zsh",
        });
        net.responses.set(MSG.SETTINGS_GET, {
            general: { defaultAgent: "codex" },
            terminal: { defaultShell: "system" },
        } as AppSettings);
        const store = new FakeStore();
        store.masterSessions = [
            { id: "master-s1", type: "shell", label: "shell", createdAt: "now" },
        ];
        store.projects = [project("p1", "Project", 12)];
        store.tasks = [task("t1", "p1", "Task", 2)];
        const sessions = withSessions
            ? [fakeBridge(test.renderer, "one"), fakeBridge(test.renderer, "two")]
            : [];
        const app = new OpenTuiApp({
            renderer: test.renderer,
            net,
            store,
            sessions,
            onCreate,
            onClose,
            onResume,
        });
        await app.init();
        await test.renderOnce();
        cleanups.push(
            () => app.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, net, store, sessions, app };
    }

    it("renders the 80x24 sidebar with truthful badges", async () => {
        const { test } = await setup();
        const frame = test.captureCharFrame();
        expect(frame).toContain("Master Workspace");
        expect(frame).toContain("Project");
        expect(frame).toContain("12");
        expect(frame).toContain("  Task");
        expect(frame).toContain("2");

        const selected = test
            .captureSpans()
            .lines.flatMap((line) => line.spans)
            .find((span) => span.text.includes("Master Workspace"));
        expect(selected?.fg.toInts()).toEqual([0, 0, 0, 255]);
        expect(selected?.bg.toInts()).toEqual([255, 255, 255, 255]);
    });

    it("draws complete borders around the sidebar and main panels", async () => {
        const { test, app } = await setup();
        const lines = test.captureCharFrame().split("\n");

        expect(lines[0]?.[0]).toBe("┌");
        expect(lines[0]?.[25]).toBe("┐");
        expect(lines[0]?.[26]).toBe("┌");
        expect(lines[0]?.[79]).toBe("┐");
        expect(lines[22]?.[0]).toBe("└");
        expect(lines[22]?.[25]).toBe("┘");
        expect(lines[22]?.[26]).toBe("└");
        expect(lines[22]?.[79]).toBe("┘");
        expect(lines[23]).toContain("↑↓ Select");
        expect(lines[23]).toContain("s New");
        expect(lines[23]).toContain("z Zoom");
        expect(app.paneDimensions).toEqual({ cols: 52, rows: 20 });
    });

    it("opens product screens only from UI focus and returns without closing a session", async () => {
        const test = await createTestRenderer({ width: 100, height: 18, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.SYSTEM_INFO, {
            editors: [],
            homedir: "/tmp",
            schedulerEnabled: false,
        });
        net.responses.set(MSG.FLOW_DEFINITIONS_LIST, {
            flows: [
                {
                    id: "flow-1",
                    name: "Release flow",
                    description: "",
                    actions: [{ id: "entry", actionId: "action-1" }],
                    createdAt: "now",
                    updatedAt: "now",
                },
            ],
        });
        net.responses.set(MSG.FLOW_ACTIONS_LIST, {
            actions: [
                {
                    id: "action-1",
                    name: "Build action",
                    prompt: "bun run build",
                    sessionType: "shell",
                    standalone: true,
                    createdAt: "now",
                    updatedAt: "now",
                },
            ],
        });
        net.responses.set(MSG.FLOW_RUNS_LIST, { runs: [] });
        net.responses.set(MSG.SCHEDULE_LIST, { schedules: [] });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        const flowStore = new FlowStore(net);
        const scheduleStore = new ScheduleStore(net);
        const app = new OpenTuiApp({
            renderer: test.renderer,
            net,
            store,
            flowStore,
            scheduleStore,
        });
        await app.init();
        test.mockInput.pressKey("f");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Release flow");
        expect(test.captureCharFrame().split("\n")[17]).toContain("Tab Switch");
        test.mockInput.pressKey("q");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("No sessions");
        test.mockInput.pressKey("c");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Schedules are read-only here");
        test.mockInput.pressKey("n");
        test.mockInput.pressKey("q");
        expect(net.requests.filter((request) => request.type === MSG.SCHEDULE_CREATE)).toHaveLength(
            0,
        );
        expect(net.requests.filter((request) => request.type === MSG.SESSION_CLOSE)).toHaveLength(
            0,
        );
        app.destroy();
        flowStore.dispose();
        scheduleStore.dispose();
        test.renderer.destroy();
    });

    it("refreshes scheduler ownership after reconnect", async () => {
        const test = await createTestRenderer({ width: 80, height: 18, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.SYSTEM_INFO, {
            editors: [],
            homedir: "/tmp",
            schedulerEnabled: false,
        });
        net.responses.set(MSG.FLOW_DEFINITIONS_LIST, { flows: [] });
        net.responses.set(MSG.FLOW_ACTIONS_LIST, { actions: [] });
        net.responses.set(MSG.FLOW_RUNS_LIST, { runs: [] });
        net.responses.set(MSG.SCHEDULE_LIST, { schedules: [] });
        const store = new FakeStore();
        const flowStore = new FlowStore(net);
        const scheduleStore = new ScheduleStore(net);
        const app = new OpenTuiApp({
            renderer: test.renderer,
            net,
            store,
            flowStore,
            scheduleStore,
        });
        await app.init();

        net.responses.set(MSG.SYSTEM_INFO, {
            editors: [],
            homedir: "/tmp",
            schedulerEnabled: true,
        });
        net.emitStatus(true);
        await Bun.sleep(0);
        test.mockInput.pressKey("c");
        await test.renderOnce();

        expect(test.captureCharFrame()).not.toContain("Schedules are read-only here");
        app.destroy();
        flowStore.dispose();
        scheduleStore.dispose();
        test.renderer.destroy();
    });

    it("handles a narrow and one-row terminal, zoom, and resize", async () => {
        const { test, app } = await setup(15, 1);
        expect(test.renderer.terminalHeight).toBe(1);
        test.mockInput.pressKey("z");
        await test.renderOnce();
        expect(app.isZoomed).toBe(true);
        test.resize(40, 8);
        await test.renderOnce();
        expect(test.renderer.terminalWidth).toBe(40);
        expect(app.paneDimensions).toEqual({ cols: 38, rows: 4 });
        const lines = test.captureCharFrame().split("\n");
        expect(lines[0]?.[0]).toBe("┌");
        expect(lines[0]?.[39]).toBe("┐");
        expect(lines[6]?.[0]).toBe("└");
        expect(lines[6]?.[39]).toBe("┘");
        expect(lines[7]).toContain("↑↓ Select");
    });

    it("keeps overflowing sidebar selection visible", async () => {
        const { test, store, app } = await setup(30, 4);
        store.tasks = Array.from({ length: 10 }, (_, index) =>
            task(`t${String(index)}`, "p1", `Task ${String(index)}`),
        );
        store.notify();
        for (let index = 0; index < 8; index += 1) test.mockInput.pressArrow("down");
        await test.renderOnce();
        expect(app.selectedIndex).toBe(8);
        expect(test.captureCharFrame()).toContain("Task 6");
    });

    it("selects sidebar rows and visible tabs at their rendered cells", async () => {
        const { test, app, sessions } = await setup(80, 24, true);
        await test.mockMouse.click(2, 2);
        expect(app.selectedIndex).toBe(1);
        await test.mockMouse.click(34, 1);
        expect(app.focus).toBe("session");
        expect(sessions[1]?.calls).toContain("focus");
        await test.mockMouse.click(2, 2);
        expect(app.focus).toBe("ui");
    });

    it("renders the warning over tabs and updates changing counts", async () => {
        const { test, net } = await setup(80, 24, true);
        net.emit(MSG.SYSTEM_CLIENTS, { count: 3 });
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("2 other client(s) attached");
        net.emit(MSG.SYSTEM_CLIENTS, { count: 1 });
        await test.renderOnce();
        expect(test.captureCharFrame()).not.toContain("other client");
    });

    it("does not request an app frame for unchanged Store state", async () => {
        const { test, store } = await setup();
        let renders = 0;
        test.renderer.requestRender = () => {
            renders += 1;
        };
        store.notify();
        expect(renders).toBe(0);
    });

    it("sanitizes control characters without damaging wide labels", () => {
        expect(cleanLabel("wide 猫\x1b[2J\nname")).toBe("wide 猫�[2J�name");
    });

    it("preserves owner selection across project reorder and task insertion", async () => {
        const { test, store, app } = await setup();
        store.projects = [project("p1", "One"), project("p2", "Two")];
        store.tasks = [task("t1", "p1", "Selected")];
        store.notify();
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        expect(app.selectedOwner).toEqual({ kind: "task", taskId: "t1", projectId: "p1" });

        store.projects = [store.projects[1], store.projects[0]];
        store.tasks = [task("t2", "p1", "Inserted"), store.tasks[0]];
        store.notify();
        expect(app.selectedOwner).toEqual({ kind: "task", taskId: "t1", projectId: "p1" });
    });

    it("falls back from a removed task to its project and then master", async () => {
        const { test, store, app } = await setup();
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        expect(app.selectedOwner).toEqual({ kind: "task", taskId: "t1", projectId: "p1" });
        store.tasks = [];
        store.notify();
        expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p1" });
        store.projects = [];
        store.notify();
        expect(app.selectedOwner).toEqual({ kind: "master" });
    });

    it("updates terminal tabs without destroying retained renderables", async () => {
        const { test, app } = await setup(80, 24, true);
        const retained = fakeBridge(test.renderer, "two");
        const added = fakeBridge(test.renderer, "three");
        const retainedRenderable = retained.bridge.renderable;
        app.setSessions([retained, added], "two");
        await test.renderOnce();
        expect(retained.bridge.renderable).toBe(retainedRenderable);
        expect(test.captureCharFrame()).toContain("two");
        expect(test.captureCharFrame()).toContain("three");
    });

    it("renders the session creation instruction for an empty owner", async () => {
        const { test, app } = await setup(80, 24, true);
        app.setSessions([]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("No sessions. Press s to start one.");
        expect(app.focus).toBe("ui");
    });

    it("focuses the main session with Enter and l from UI focus", async () => {
        const { test, app } = await setup(80, 24, true);
        expect(test.captureCharFrame().split("\n")[23]).toContain("Enter Focus");
        test.mockInput.pressEnter();
        await test.renderOnce();
        expect(app.focus).toBe("session");
        expect(test.captureCharFrame().split("\n")[23]).toContain("App controls");
        test.mockInput.pressEscape({ ctrl: true });
        await test.renderOnce();
        expect(app.focus).toBe("ui");
        expect(test.captureCharFrame().split("\n")[23]).toContain("q Close");
        test.mockInput.pressKey("l");
        expect(app.focus).toBe("session");
    });

    it("creates a clean task agent with the captured owner and visible pane size", async () => {
        const creates: Array<{ owner: unknown; payload: SessionCreatePayload }> = [];
        const { test, store } = await setup(90, 30, false, async (owner, payload) => {
            creates.push({ owner, payload });
            return "created";
        });
        store.tasks[0].description = "Task prompt";
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("s");
        await Promise.resolve();
        await Promise.resolve();
        test.mockInput.pressEnter();
        await Promise.resolve();
        expect(creates).toEqual([
            {
                owner: { kind: "task", taskId: "t1", projectId: "p1" },
                payload: {
                    taskId: "t1",
                    type: "codex",
                    cols: 58,
                    rows: 26,
                },
            },
        ]);
    });

    it("suppresses repeated create confirmation while the request is pending", async () => {
        let resolveCreate = (_id: string): void => undefined;
        const pending = new Promise<string>((resolve) => {
            resolveCreate = resolve;
        });
        let calls = 0;
        const { test } = await setup(80, 24, false, () => {
            calls += 1;
            return pending;
        });
        test.mockInput.pressKey("s");
        await Promise.resolve();
        await Promise.resolve();
        test.mockInput.pressEnter();
        test.mockInput.pressEnter();
        expect(calls).toBe(1);
        resolveCreate("created");
        await pending;
    });

    it("cancels the creation picker with Escape without sending a request", async () => {
        let calls = 0;
        const { test } = await setup(80, 24, false, async () => {
            calls += 1;
            return "created";
        });
        test.mockInput.pressKey("s");
        await Promise.resolve();
        await Promise.resolve();
        await test.renderOnce();
        expect(test.captureCharFrame().split("\n")[23]).toContain("Enter Start");
        test.mockInput.pressEscape();
        expect(calls).toBe(0);
    });

    it("requires confirmation before closing and waits for Store to remove the tab", async () => {
        const closed: string[] = [];
        const { test, app } = await setup(80, 24, true, undefined, async (sessionId) => {
            closed.push(sessionId);
        });
        test.mockInput.pressKey("q");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("terminates the process");
        test.mockInput.pressKey("y");
        test.mockInput.pressEnter();
        expect(closed).toEqual(["one"]);
        expect(test.captureCharFrame()).toContain("one");
        app.setSessions([]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("No sessions. Press s to start one.");
    });

    it("keeps the terminal and shows an error when close fails", async () => {
        const { test } = await setup(80, 24, true, undefined, async () => {
            throw new Error("backend refused");
        });
        test.mockInput.pressKey("q");
        test.mockInput.pressKey("y");
        await Promise.resolve();
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Could not close session: backend refused");
        expect(test.captureCharFrame()).toContain("one");
    });

    it("passes q to the child while terminal focus is active", async () => {
        const { test, app } = await setup(80, 24, true);
        test.mockInput.pressEnter();
        expect(app.focus).toBe("session");
        test.mockInput.pressKey("q");
        await test.renderOnce();
        expect(test.captureCharFrame()).not.toContain("Close session");
    });

    it("marks interrupted agents and resumes with current pane dimensions once", async () => {
        let resolveResume = (): void => undefined;
        const pending = new Promise<void>((resolve) => {
            resolveResume = resolve;
        });
        const resumes: Array<{ sessionId: string; cols: number; rows: number }> = [];
        const { test, app } = await setup(
            90,
            30,
            false,
            undefined,
            undefined,
            (sessionId, cols, rows) => {
                resumes.push({ sessionId, cols, rows });
                return pending;
            },
        );
        const interrupted = fakeBridge(test.renderer, "agent");
        app.setSessions([
            {
                ...interrupted,
                type: "codex",
                state: "interrupted",
                nativeSessionId: "native-agent",
            },
        ]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("agent [interrupted]");
        expect(test.captureCharFrame()).toContain("Press r to resume");
        test.mockInput.pressKey("r");
        test.mockInput.pressKey("r");
        expect(resumes).toEqual([{ sessionId: "agent", cols: 58, rows: 26 }]);
        resolveResume();
        await pending;
    });

    it("shows why an interrupted shell cannot resume", async () => {
        const { test, app } = await setup();
        const interrupted = fakeBridge(test.renderer, "shell");
        app.setSessions([
            {
                ...interrupted,
                type: "shell",
                state: "interrupted",
            },
        ]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Interrupted shell sessions cannot be resumed");
    });

    it("keeps the interrupted tab and shows a retry message after resume failure", async () => {
        const { test, app } = await setup(80, 24, false, undefined, undefined, async () => {
            throw new Error("native session missing");
        });
        const interrupted = fakeBridge(test.renderer, "agent");
        const renderable = interrupted.bridge.renderable;
        app.setSessions([
            {
                ...interrupted,
                type: "codex",
                state: "interrupted",
                nativeSessionId: "native-agent",
            },
        ]);
        test.mockInput.pressKey("r");
        await Promise.resolve();
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Resume failed: native session missing");
        expect(interrupted.bridge.renderable).toBe(renderable);
    });
});
