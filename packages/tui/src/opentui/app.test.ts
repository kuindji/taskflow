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
import { ArchiveStore } from "../archive/store";
import { FlowStore } from "../flows/store";
import { ScheduleStore } from "../schedules/store";
import { TaskDetailStore } from "../tasks/store";
import { GitStore } from "../git/store";
import { SettingsStore } from "../settings/store";
import { NotificationStore } from "../notifications/store";
import { OfflineGuardNet } from "../net/offline-guard";
import { ProjectStore } from "../projects/store";
import type { SessionOwner } from "../sessions/owner";
import { Store } from "../state/store";
import { SessionBridge } from "./session-bridge";
import {
    OpenTuiApp,
    buildRows,
    cleanLabel,
    type OpenTuiAppDeps,
    type SessionBridgeLike,
    type StoreLike,
} from "./app";
import { FakeNet, fullSettings, project, task } from "./test-helpers";

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
    projectById(projectId: string): Project | null {
        return this.projects.find((candidate) => candidate.id === projectId) ?? null;
    }
    taskById(taskId: string): Task | null {
        return this.tasks.find((candidate) => candidate.id === taskId) ?? null;
    }
    applyServerTask(task: Task): void {
        const index = this.tasks.findIndex((candidate) => candidate.id === task.id);
        if (index < 0) this.tasks.push(task);
        else this.tasks[index] = task;
        this.notify();
    }
    applyTask(task: Task): void {
        this.applyServerTask(task);
    }
    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    notify(): void {
        for (const listener of this.listeners) listener();
    }
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
        extra: Partial<OpenTuiAppDeps> = {},
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
            claude: {
                defaultModel: "default",
                defaultEffort: "default",
                permissionMode: "default",
            },
            codex: {
                defaultModel: "",
                defaultReasoningEffort: "default",
                sandbox: "workspace-write",
                approvalPolicy: "on-request",
                dangerouslyBypassApprovalsAndSandbox: false,
            },
            opencode: { defaultModel: "", autoApprove: false },
            pi: { defaultModel: "", thinking: "off", tools: "" },
            kimi: { defaultModel: "", permissionMode: "manual" },
        } as unknown as AppSettings);
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
            local: true,
            net,
            store,
            sessions,
            onCreate,
            onClose,
            onResume,
            ...extra,
        });
        await app.init();
        await test.renderOnce();
        cleanups.push(
            () => app.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, net, store, sessions, app };
    }

    it("shows the machine label and opens the machine switcher with m", async () => {
        let switches = 0;
        const { test } = await setup(100, 24, false, undefined, undefined, undefined, {
            machineLabel: "Studio Mac",
            onSwitchMachine: () => switches++,
        });
        const lines = test.captureCharFrame().split("\n");
        expect(lines[0]).toContain("Studio Mac");
        expect(lines[23]).toContain("m Machines");

        test.mockInput.pressKey("m");
        expect(switches).toBe(1);
    });

    it("does not open the machine switcher from a product screen", async () => {
        let switches = 0;
        const { test } = await setup(100, 24, false, undefined, undefined, undefined, {
            onSwitchMachine: () => switches++,
        });
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Project: Project");

        test.mockInput.pressKey("m");
        expect(switches).toBe(0);
    });

    it("gives an external overlay the keys and the footer until it closes", async () => {
        const { test, app } = await setup(100, 24);
        const keys: string[] = [];
        let hints = " Overlay hints";
        const handle = app.showOverlay({
            get keyHints() {
                return hints;
            },
            handleKey: (event) => {
                if (event.eventType === "press") keys.push(event.name);
            },
        });
        await test.renderOnce();
        expect(test.captureCharFrame().split("\n")[23]).toContain("Overlay hints");

        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        await test.renderOnce();
        expect(keys).toEqual(["down", "t"]);
        expect(test.captureCharFrame()).not.toContain("Project: Project");

        hints = " Connecting";
        handle.refresh();
        await test.renderOnce();
        expect(test.captureCharFrame().split("\n")[23]).toContain("Connecting");

        handle.close();
        await test.renderOnce();
        expect(test.captureCharFrame().split("\n")[23]).toContain("? Help");
        test.mockInput.pressKey("?");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Taskflow keyboard help");
        expect(keys).toEqual(["down", "t"]);
    });

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
        expect(lines[23]).toContain("? Help");
        expect(app.paneDimensions).toEqual({ cols: 52, rows: 20 });
    });

    it("opens help above the current screen and restores that screen on close", async () => {
        const { test } = await setup(100, 24);
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Project: Project");

        test.mockInput.pressKey("?");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Taskflow keyboard help");
        expect(test.captureCharFrame().split("\n")[23]).toContain("Close help");

        test.mockInput.pressEscape();
        await test.renderOnce();
        expect(test.captureCharFrame()).not.toContain("Taskflow keyboard help");
        expect(test.captureCharFrame()).toContain("Project: Project");
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
            local: true,
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

    it("explains the terminal editor handoff before opening a YAML record", async () => {
        const test = await createTestRenderer({ width: 100, height: 20, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.SYSTEM_INFO, {
            editors: [
                { id: "nvim", name: "Neovim", command: "nvim", type: "internal" },
                { id: "zed", name: "Zed", command: "zed", type: "external" },
            ],
            homedir: "/tmp",
            schedulerEnabled: true,
        });
        net.responses.set(MSG.SETTINGS_GET, fullSettings());
        net.responses.set(MSG.FLOW_DEFINITIONS_LIST, { flows: [] });
        net.responses.set(MSG.FLOW_ACTIONS_LIST, { actions: [] });
        net.responses.set(MSG.FLOW_RUNS_LIST, { runs: [] });
        net.responses.set(MSG.SCHEDULE_LIST, { schedules: [] });
        const store = new FakeStore();
        const flowStore = new FlowStore(net);
        const scheduleStore = new ScheduleStore(net);
        const settingsStore = new SettingsStore(net);
        const edits: string[] = [];
        const app = new OpenTuiApp({
            renderer: test.renderer,
            local: true,
            net,
            store,
            flowStore,
            scheduleStore,
            settingsStore,
            onEditRecord: async (kind) => {
                edits.push(kind);
            },
        });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => flowStore.dispose(),
            () => scheduleStore.dispose(),
            () => settingsStore.dispose(),
            () => test.renderer.destroy(),
        );

        test.mockInput.pressKey("f");
        test.mockInput.pressKey("n");
        await Bun.sleep(0);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Open terminal editor");
        expect(test.captureCharFrame()).toContain("open flow.yaml in Neovim");
        expect(test.captureCharFrame()).toContain("close the editor to return to Taskflow");
        expect(edits).toEqual([]);

        test.mockInput.pressEnter();
        await Bun.sleep(0);
        expect(edits).toEqual(["flow"]);
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
            local: true,
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

    it("filters owner rows by project name or task title", () => {
        const store = new FakeStore();
        store.projects = [project("p1", "Alpha"), project("p2", "Beta")];
        store.tasks = [
            task("t1", "p1", "First task"),
            task("t2", "p1", "Needle task"),
            task("t3", "p2", "Other task"),
        ];

        expect(buildRows(store, new Set(["p1"]), "needle").map((row) => row.label)).toEqual([
            "Alpha",
            "Needle task",
        ]);
        expect(buildRows(store, new Set(["p1"]), "beta").map((row) => row.label)).toEqual([
            "Beta",
            "Other task",
        ]);
    });

    it("applies the owner filter and selects its first visible result", async () => {
        const { test, store, app } = await setup();
        store.projects = [project("p1", "Alpha"), project("p2", "Beta")];
        store.tasks = [task("t1", "p1", "Needle task"), task("t2", "p2", "Other task")];
        store.notify();

        test.mockInput.pressKey("/");
        await test.mockInput.typeText("needle");
        test.mockInput.pressEnter();
        await test.renderOnce();

        const frame = test.captureCharFrame();
        expect(frame).toContain("Alpha");
        expect(frame).toContain("Needle task");
        expect(frame).not.toContain("Beta");
        expect(frame).not.toContain("Master Workspace");
        expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p1" });
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

    it("opens the selected task detail with t and Enter when it has no session", async () => {
        const test = await createTestRenderer({ width: 90, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.TASK_LOG_LIST, { entries: [] });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        store.tasks = [
            {
                ...task("t1", "p1", "Selected task"),
                description: "Selected description",
            },
        ];
        const taskStore = new TaskDetailStore(net);
        const app = new OpenTuiApp({ renderer: test.renderer, local: true, net, store, taskStore });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => taskStore.dispose(),
            () => test.renderer.destroy(),
        );
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Selected description");
        store.applyServerTask({ ...store.tasks[0], notes: "Saved without changing the sidebar" });
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Saved without changing the sidebar");
        test.mockInput.pressKey("q");
        test.mockInput.pressEnter();
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Selected description");
    });

    it("creates a top-level task from a project and consumes duplicate submit keys", async () => {
        const test = await createTestRenderer({ width: 90, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        const created = { ...task("new-task", "p1", "New task"), description: "Do work" };
        net.responses.set(MSG.TASK_CREATE, created);
        net.responses.set(MSG.TASK_LOG_LIST, { entries: [] });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        const taskStore = new TaskDetailStore(net);
        const app = new OpenTuiApp({ renderer: test.renderer, local: true, net, store, taskStore });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => taskStore.dispose(),
            () => test.renderer.destroy(),
        );
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("n");
        await test.mockInput.typeText("New task");
        test.mockInput.pressArrow("down");
        await test.mockInput.typeText("Do work");
        test.mockInput.pressEnter();
        test.mockInput.pressEnter();
        await Promise.resolve();
        await test.renderOnce();
        expect(net.requests.filter((request) => request.type === MSG.TASK_CREATE)).toEqual([
            {
                type: MSG.TASK_CREATE,
                payload: {
                    projectId: "p1",
                    parentId: undefined,
                    title: "New task",
                    description: "Do work",
                    worktree: false,
                    initCommand: undefined,
                },
            },
        ]);
        expect(app.selectedOwner).toEqual({
            kind: "task",
            taskId: "new-task",
            projectId: "p1",
        });
        expect(test.captureCharFrame()).toContain("Do work");
    });

    it("requires archive confirmation and falls back to the task project", async () => {
        const test = await createTestRenderer({ width: 90, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        const active = task("t1", "p1", "Archive me");
        net.responses.set(MSG.TASK_LOG_LIST, { entries: [] });
        net.responses.set(MSG.TASK_ARCHIVE, {
            ...active,
            status: "archived",
            archivedAt: "2026-08-25T12:00:00.000Z",
        });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        store.tasks = [active];
        const taskStore = new TaskDetailStore(net);
        const app = new OpenTuiApp({ renderer: test.renderer, local: true, net, store, taskStore });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => taskStore.dispose(),
            () => test.renderer.destroy(),
        );
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        test.mockInput.pressKey("a");
        expect(net.requests.filter((request) => request.type === MSG.TASK_ARCHIVE)).toHaveLength(0);
        test.mockInput.pressKey("y");
        await Promise.resolve();
        await test.renderOnce();
        expect(net.requests.filter((request) => request.type === MSG.TASK_ARCHIVE)).toHaveLength(1);
        expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p1" });
        expect(test.captureCharFrame()).toContain("No sessions");
    });

    it("opens task Git at the resolved project path and commits staged files without push", async () => {
        const test = await createTestRenderer({ width: 100, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.GIT_STATUS, {
            status: {
                branch: "feature",
                ahead: 0,
                behind: 0,
                stagedFiles: [{ path: "file.ts", status: "modified", staged: true }],
                unstagedFiles: [],
            },
        });
        net.responses.set(MSG.GIT_DIFF_FILE, { staged: "@@ -1 +1 @@\n-old\n+new" });
        net.responses.set(MSG.GIT_COMMIT, { hash: "abc123", message: "fix file" });
        net.responses.set(MSG.GIT_GENERATE_COMMIT_MSG, { message: "generated" });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        store.tasks = [task("t1", "p1", "Task")];
        const gitStore = new GitStore(net);
        const app = new OpenTuiApp({ renderer: test.renderer, local: true, net, store, gitStore });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => gitStore.dispose(),
            () => test.renderer.destroy(),
        );
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("g");
        await Promise.resolve();
        await Promise.resolve();
        await test.renderOnce();
        expect(net.requests.find((request) => request.type === MSG.GIT_STATUS)?.payload).toEqual({
            path: "/tmp/p1",
        });
        expect(test.captureCharFrame()).toContain("file.ts");
        expect(
            net.requests.filter((request) => request.type === MSG.GIT_GENERATE_COMMIT_MSG),
        ).toHaveLength(0);

        test.mockInput.pressKey("c");
        await test.mockInput.typeText("fix file");
        test.mockInput.pressEnter();
        await Promise.resolve();
        await Promise.resolve();
        expect(net.requests.find((request) => request.type === MSG.GIT_COMMIT)?.payload).toEqual({
            path: "/tmp/p1",
            message: "fix file",
            push: false,
            includeUnstaged: false,
        });
    });

    it("applies sidebar width and collapsed projects without retaining a hidden task owner", async () => {
        const test = await createTestRenderer({ width: 80, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.SETTINGS_GET, fullSettings());
        net.responses.set(
            MSG.SETTINGS_UPDATE,
            fullSettings({ sidebarWidth: 160, collapsedProjectIds: ["p1"] }),
        );
        net.responses.set(MSG.SYSTEM_INFO, {
            editors: [],
            homedir: "/tmp",
            schedulerEnabled: false,
        });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        store.tasks = [task("t1", "p1", "Hidden task")];
        const settingsStore = new SettingsStore(net);
        const app = new OpenTuiApp({
            renderer: test.renderer,
            local: true,
            net,
            store,
            settingsStore,
        });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => settingsStore.dispose(),
            () => test.renderer.destroy(),
        );
        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        expect(app.selectedOwner).toEqual({ kind: "task", taskId: "t1", projectId: "p1" });
        await settingsStore.update({
            layout: { panels: { sidebarWidth: 160, collapsedProjectIds: ["p1"] } },
        });
        await test.renderOnce();
        expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p1" });
        expect(test.captureCharFrame()).not.toContain("Hidden task");
        expect(app.paneDimensions).toEqual({ cols: 58, rows: 20 });
    });

    it("shows unread notifications and navigates to their task owner", async () => {
        const test = await createTestRenderer({ width: 120, height: 24, kittyKeyboard: true });
        const net = new FakeNet();
        net.responses.set(MSG.NOTIFICATION_LIST, {
            notifications: [
                {
                    id: "n1",
                    projectId: "p1",
                    taskId: "t1",
                    sessionId: "missing-session",
                    message: "Task finished",
                    read: false,
                    createdAt: "2026-08-25T12:00:00.000Z",
                },
            ],
        });
        net.responses.set(MSG.NOTIFICATION_UPDATED, { success: true });
        const store = new FakeStore();
        store.projects = [project("p1", "Project")];
        store.tasks = [task("t1", "p1", "Task")];
        const notificationStore = new NotificationStore(net);
        const app = new OpenTuiApp({
            renderer: test.renderer,
            local: true,
            net,
            store,
            notificationStore,
        });
        await app.init();
        cleanups.push(
            () => app.destroy(),
            () => notificationStore.dispose(),
            () => test.renderer.destroy(),
        );
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Notifications (1)");
        test.mockInput.pressKey("!");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Task finished");
        test.mockInput.pressEnter();
        expect(app.selectedOwner).toEqual({ kind: "task", taskId: "t1", projectId: "p1" });
        expect(net.requests.filter((request) => request.type === MSG.NOTIFICATION_UPDATED)).toEqual(
            [{ type: MSG.NOTIFICATION_UPDATED, payload: { id: "n1" } }],
        );
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
                    agentOptions: {
                        type: "codex",
                        sandbox: "workspace-write",
                        approvalPolicy: "on-request",
                        dangerouslyBypassApprovalsAndSandbox: false,
                    },
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

    it("marks a project whose folder is missing with !", async () => {
        const { test, store } = await setup(100);
        store.projects = [
            { ...project("p1", "Missing Folder"), locationValid: false },
            project("p2", "Present Folder"),
        ];
        store.notify();
        await test.renderOnce();
        const lines = test.captureCharFrame().split("\n");
        expect(lines.find((line) => line.includes("Missing Folder"))).toContain("! Missing Folder");
        expect(lines.find((line) => line.includes("Present Folder"))).not.toContain("!");
    });

    describe("project commands", () => {
        const PROJECT_REQUESTS: readonly string[] = [
            MSG.PROJECT_ADD,
            MSG.PROJECT_UPDATE,
            MSG.PROJECT_REMOVE,
            MSG.PROJECT_REORDER,
        ];

        async function projectSetup(local: boolean) {
            const test = await createTestRenderer({ width: 160, height: 24, kittyKeyboard: true });
            const net = new FakeNet();
            net.responses.set(MSG.PROJECT_LIST, {
                projects: [project("p1", "First Project"), project("p2", "Second Project")],
            });
            net.responses.set(MSG.TASK_LIST, { tasks: [] });
            net.responses.set(MSG.MASTER_SESSIONS_LIST, { sessions: [] });
            net.responses.set(MSG.PROJECT_UPDATE, {
                ...project("p1", "First Project"),
                hidden: true,
            });
            net.responses.set(MSG.PROJECT_REMOVE, { success: true });
            net.responses.set(MSG.PROJECT_REORDER, { projects: [] });
            const store = new Store(net);
            const projectStore = new ProjectStore(net, store);
            const app = new OpenTuiApp({
                renderer: test.renderer,
                local,
                net,
                store,
                projectStore,
            });
            await app.init();
            cleanups.push(
                () => app.destroy(),
                () => store.dispose(),
                () => test.renderer.destroy(),
            );
            await test.renderOnce();
            const frame = (): string => test.captureCharFrame();
            const footer = (): string => frame().split("\n")[23];
            const projectRequests = () =>
                net.requests.filter((request) => PROJECT_REQUESTS.includes(request.type));
            const settle = async (): Promise<void> => {
                await Bun.sleep(1);
                await test.renderOnce();
            };
            return { test, net, store, app, frame, footer, projectRequests, settle };
        }

        it("hides them on a remote machine and sends nothing for any of the five", async () => {
            const { test, app, frame, footer, projectRequests, settle } = await projectSetup(false);
            expect(footer()).toContain("z Zoom");
            expect(footer()).not.toContain("p Add project");

            test.mockInput.pressKey("p");
            await settle();
            expect(footer()).toContain("Only available on this machine.");
            expect(frame()).not.toContain("Project path");

            test.mockInput.pressArrow("down");
            expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p1" });
            for (const letter of ["X", "J", "K", "L"]) {
                test.mockInput.pressKey(letter);
                await settle();
                expect(footer()).toContain("Only available on this machine.");
            }
            expect(projectRequests()).toEqual([]);
            expect(frame()).not.toContain("Keep project data");
            expect(frame()).not.toContain("Linked projects");
        });

        it("shows and opens add project on this machine", async () => {
            const { test, frame, footer, settle } = await projectSetup(true);
            expect(footer()).toContain("p Add project");

            test.mockInput.pressKey("p");
            await settle();
            expect(frame()).toContain("Project path");
            expect(frame()).not.toContain("Only available on this machine.");
        });

        it("X hides the project while Keep project data is on", async () => {
            const { test, store, frame, projectRequests, settle } = await projectSetup(true);
            test.mockInput.pressArrow("down");
            test.mockInput.pressKey("X");
            await settle();
            expect(frame()).toContain("[x] Keep project data");
            expect(frame()).toContain('Hide "First Project"?');

            test.mockInput.pressEnter();
            await settle();
            expect(projectRequests()).toEqual([
                { type: MSG.PROJECT_UPDATE, payload: { id: "p1", hidden: true } },
            ]);
            expect(store.projects.map((p) => p.id)).toEqual(["p2"]);
            expect(frame()).not.toContain("Keep project data");
        });

        it("X removes the project once Keep project data is off", async () => {
            const { test, store, frame, projectRequests, settle } = await projectSetup(true);
            test.mockInput.pressArrow("down");
            test.mockInput.pressKey("X");
            await settle();
            test.mockInput.pressKey("t");
            await settle();
            expect(frame()).toContain("[ ] Keep project data");
            expect(frame()).toContain('Permanently remove "First Project"');

            test.mockInput.pressEnter();
            await settle();
            expect(projectRequests()).toEqual([
                { type: MSG.PROJECT_REMOVE, payload: { id: "p1" } },
            ]);
            expect(store.projectById("p1")).toBeNull();
        });

        it("J on the last project does nothing and K moves it up", async () => {
            const { test, store, app, projectRequests, settle } = await projectSetup(true);
            test.mockInput.pressArrow("down");
            test.mockInput.pressArrow("down");
            expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p2" });

            test.mockInput.pressKey("J");
            await settle();
            expect(projectRequests()).toEqual([]);
            expect(store.projectOrder).toEqual(["p1", "p2"]);

            test.mockInput.pressKey("K");
            await settle();
            expect(projectRequests()).toEqual([
                { type: MSG.PROJECT_REORDER, payload: { orderedIds: ["p2", "p1"] } },
            ]);
            expect(store.projectOrder).toEqual(["p2", "p1"]);
            expect(app.selectedOwner).toEqual({ kind: "project", projectId: "p2" });
        });
    });

    describe("archived tasks", () => {
        const ARCHIVED_AT = "2026-09-01T10:00:00.000Z";

        function archived(id: string, title: string, extra: Partial<Task> = {}): Task {
            return {
                ...task(id, "p1", title),
                status: "archived",
                archivedAt: ARCHIVED_AT,
                ...extra,
            };
        }

        // Payload order is deliberately not parent-first: nesting must reorder it.
        function archivedTasks(): Task[] {
            return [
                archived("s2", "Needle sub", {
                    parentId: "a1",
                    sessions: task("x", "p1", "", 2).sessions,
                }),
                archived("a2", "Plain archived"),
                archived("a1", "Old parent", {
                    worktree: { enabled: true, path: "/tmp/wt", branch: "feature/old", pr: null },
                    attributes: [{ id: "attr-1", name: "stack", value: "bun" }],
                }),
                archived("s1", "First sub", { parentId: "a1" }),
                archived("s3", "Orphan sub", { parentId: "t1" }),
            ];
        }

        const MUTATIONS: readonly string[] = [
            MSG.TASK_UPDATE,
            MSG.TASK_ARCHIVE,
            MSG.ATTR_CREATE,
            MSG.ATTR_UPDATE,
            MSG.ATTR_DELETE,
            MSG.TASK_UNARCHIVE,
            MSG.TASK_DELETE,
        ];

        async function archiveSetup(local = true) {
            const test = await createTestRenderer({ width: 160, height: 40, kittyKeyboard: true });
            const net = new FakeNet();
            net.responses.set(MSG.PROJECT_LIST, {
                projects: [project("p1", "Alpha"), project("p2", "Beta")],
            });
            net.responses.set(MSG.TASK_LIST, {
                tasks: [task("t1", "p1", "Active task"), task("t2", "p2", "Beta task")],
            });
            net.responses.set(MSG.MASTER_SESSIONS_LIST, { sessions: [] });
            net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: archivedTasks() });
            net.responses.set(MSG.TASK_LOG_LIST, { entries: [] });
            net.responses.set(MSG.TASK_DELETE, { success: true });
            const store = new Store(net);
            const archiveStore = new ArchiveStore(net);
            const taskStore = new TaskDetailStore(net);
            let textEdits = 0;
            const app = new OpenTuiApp({
                renderer: test.renderer,
                local,
                net,
                store,
                archiveStore,
                taskStore,
                onEditTaskText: async () => {
                    textEdits++;
                    return null;
                },
            });
            await app.init();
            cleanups.push(
                () => app.destroy(),
                () => taskStore.dispose(),
                () => store.dispose(),
                () => test.renderer.destroy(),
            );
            await test.renderOnce();
            const frame = (): string => test.captureCharFrame();
            const lines = (): string[] => frame().split("\n");
            const footer = (): string => lines()[39];
            /** Frame text with borders removed and wrapped lines joined. */
            const flat = (): string =>
                lines()
                    .map((line) =>
                        line
                            .replace(/[│┌┐└┘─]/g, " ")
                            .trim()
                            .replace(/\s+/g, " "),
                    )
                    .join(" ");
            const sent = (type: string) => net.requests.filter((request) => request.type === type);
            const settle = async (): Promise<void> => {
                await Bun.sleep(1);
                await test.renderOnce();
            };
            const selectRow = async (label: string): Promise<void> => {
                for (let step = 0; step < 20; step++) {
                    const owner = app.selectedOwner;
                    const current =
                        owner.kind === "task"
                            ? archiveStore
                                  .tasks()
                                  .find((candidate) => candidate.id === owner.taskId)
                            : null;
                    if (current?.title === label) return;
                    test.mockInput.pressArrow("down");
                }
                throw new Error(`row not found: ${label}`);
            };
            const enterArchive = async (): Promise<void> => {
                test.mockInput.pressKey("A");
                await settle();
            };
            return {
                test,
                net,
                store,
                archiveStore,
                app,
                frame,
                lines,
                footer,
                flat,
                sent,
                settle,
                selectRow,
                enterArchive,
                textEdits: () => textEdits,
            };
        }

        it("builds the active rows through RowSource exactly as before", async () => {
            const net = new FakeNet();
            net.responses.set(MSG.PROJECT_LIST, {
                projects: [project("p1", "Alpha"), project("p2", "Beta")],
            });
            net.responses.set(MSG.TASK_LIST, {
                tasks: [
                    task("t1", "p1", "Active task"),
                    { ...task("t9", "p1", "Sub"), parentId: "t1" },
                ],
            });
            net.responses.set(MSG.MASTER_SESSIONS_LIST, { sessions: [] });
            const store = new Store(net);
            await store.load();
            cleanups.push(() => store.dispose());

            const viaSource = buildRows(store, new Set(), "", {
                includeMaster: true,
                tasksFor: (projectId) => store.tasksFor(projectId),
                omitEmptyProjects: false,
                nestSubtasks: false,
            });

            expect(viaSource).toEqual(buildRows(store));
            expect(viaSource.map((row) => row.label)).toEqual([
                "Master Workspace",
                "Alpha",
                "Active task",
                "Sub",
                "Beta",
            ]);
        });

        it("A loads the archive once per entry and titles the sidebar Archive", async () => {
            const { test, lines, sent, settle, enterArchive } = await archiveSetup();
            expect(lines()[0]).not.toContain("Archive");
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(0);

            await enterArchive();
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(1);
            expect(lines()[0]).toContain("Archive");

            test.mockInput.pressKey("A");
            await settle();
            expect(lines()[0]).not.toContain("Archive");
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(1);

            await enterArchive();
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(2);
        });

        it("groups rows by project and parent without Master Workspace or empty projects", async () => {
            const { frame, lines, enterArchive } = await archiveSetup();
            await enterArchive();

            // The footer's `A Active tasks` hint is not a row, so only the panels are checked.
            const panels = lines().slice(0, 39).join("\n");
            expect(frame()).not.toContain("Master Workspace");
            expect(panels).not.toContain("Beta");
            expect(panels).not.toContain("Active task");
            const row = (text: string): number => lines().findIndex((line) => line.includes(text));
            expect(row("Alpha")).toBe(1);
            expect(row("Plain archived")).toBe(2);
            expect(row("Old parent")).toBe(3);
            expect(lines()[4]).toContain("└ Needle sub");
            expect(lines()[5]).toContain("└ First sub");
            expect(row("Orphan sub")).toBe(6);
            expect(lines()[6]).not.toContain("└");
        });

        it("keeps a parent row when the name filter matches its subtask", async () => {
            const net = new FakeNet();
            const store = new FakeStore();
            store.projects = [project("p1", "Alpha"), project("p2", "Beta")];
            net.responses.set(MSG.TASK_LIST_ARCHIVED, { tasks: archivedTasks() });
            const archiveStore = new ArchiveStore(net);
            await archiveStore.load();
            const source = {
                includeMaster: false,
                tasksFor: (projectId: string) =>
                    archiveStore.tasks().filter((candidate) => candidate.projectId === projectId),
                omitEmptyProjects: true,
                nestSubtasks: true,
            };

            expect(buildRows(store, new Set(), "needle", source).map((row) => row.label)).toEqual([
                "Alpha",
                "Old parent",
                "  └ Needle sub",
            ]);
        });

        it("applies the name filter in archive mode", async () => {
            const { test, frame, settle, enterArchive } = await archiveSetup();
            await enterArchive();
            test.mockInput.pressKey("/");
            await test.mockInput.typeText("needle");
            test.mockInput.pressEnter();
            await settle();

            expect(frame()).toContain("Old parent");
            expect(frame()).toContain("Needle sub");
            expect(frame()).not.toContain("Plain archived");
            expect(frame()).not.toContain("First sub");
        });

        it("keeps an archived subtask selected across store changes and opens it read-only", async () => {
            const { test, net, app, frame, sent, settle, selectRow, enterArchive, textEdits } =
                await archiveSetup();
            await enterArchive();
            await selectRow("Needle sub");
            expect(app.selectedOwner).toEqual({ kind: "task", taskId: "s2", projectId: "p1" });
            expect(app.selectedSessions).toEqual([]);

            net.emit(MSG.TASK_UPDATED, { ...task("t1", "p1", "Active task renamed") });
            await settle();
            expect(app.selectedOwner).toEqual({ kind: "task", taskId: "s2", projectId: "p1" });

            test.mockInput.pressEnter();
            await settle();
            expect(frame()).toContain("Needle sub");
            expect(frame()).toContain("Archived 2026-09-01 · purged after 30 days");
            expect(frame()).toContain("stack = bun  (parent)");

            const before = net.requests.length;
            for (const letter of ["r", "e", "o", "n", "u", "d", "p", "a"]) {
                test.mockInput.pressKey(letter);
                await test.mockInput.typeText("x");
                test.mockInput.pressEnter();
                await settle();
            }
            const after = net.requests
                .slice(before)
                .filter((request) => MUTATIONS.includes(request.type));
            expect(after).toEqual([]);
            expect(sent(MSG.TASK_UPDATE)).toEqual([]);
            expect(textEdits()).toBe(0);
        });

        it("u restores the task and leaves archive mode with it selected", async () => {
            const {
                test,
                net,
                archiveStore,
                app,
                lines,
                frame,
                sent,
                settle,
                selectRow,
                enterArchive,
            } = await archiveSetup();
            await enterArchive();
            await selectRow("Old parent");
            const restored = {
                ...archived("a1", "Old parent"),
                status: "active" as const,
                archivedAt: null,
            };
            net.responses.set(MSG.TASK_UNARCHIVE, restored);
            net.responses.set(MSG.TASK_LIST, {
                tasks: [
                    restored,
                    { ...task("s1", "p1", "First sub"), parentId: "a1" },
                    { ...task("s2", "p1", "Needle sub"), parentId: "a1" },
                    task("t1", "p1", "Active task"),
                    task("t2", "p2", "Beta task"),
                ],
            });

            test.mockInput.pressKey("u");
            await settle();
            await settle();

            expect(sent(MSG.TASK_UNARCHIVE)).toEqual([
                { type: MSG.TASK_UNARCHIVE, payload: { id: "a1" } },
            ]);
            expect(archiveStore.tasks().map((candidate) => candidate.id)).toEqual(["a2", "s3"]);
            expect(lines()[0]).not.toContain("Archive");
            expect(frame()).toContain("Master Workspace");
            expect(app.selectedOwner).toEqual({ kind: "task", taskId: "a1", projectId: "p1" });
        });

        it("u keeps the restored task selected when the task reload fails", async () => {
            const { test, net, app, lines, frame, settle, selectRow, enterArchive } =
                await archiveSetup();
            await enterArchive();
            await selectRow("Old parent");
            net.responses.set(MSG.TASK_UNARCHIVE, {
                ...archived("a1", "Old parent"),
                status: "active" as const,
                archivedAt: null,
            });
            // Without a TASK_LIST stub the FakeNet rejects, so `Store.load()` fails.
            net.responses.delete(MSG.TASK_LIST);

            test.mockInput.pressKey("u");
            await settle();
            await settle();

            expect(lines()[0]).not.toContain("Archive");
            expect(app.selectedOwner).toEqual({ kind: "task", taskId: "a1", projectId: "p1" });
            expect(frame()).toContain("Could not reload tasks: Unexpected request: task:list");
        });

        it("D on a top-level task with a worktree offers the worktree toggle, off", async () => {
            const { test, flat, sent, frame, settle, selectRow, enterArchive } =
                await archiveSetup();
            await enterArchive();
            await selectRow("Old parent");

            test.mockInput.pressKey("D");
            await settle();
            expect(flat()).toContain(
                "Permanently delete this task and its 2 subtasks, their sessions, and all logs. This cannot be undone.",
            );
            expect(flat()).toContain("[ ] Also delete worktree and branch (feature/old)");

            test.mockInput.pressEnter();
            await settle();
            expect(sent(MSG.TASK_DELETE)).toEqual([
                { type: MSG.TASK_DELETE, payload: { id: "a1", deleteWorktree: false } },
            ]);
            expect(frame()).not.toContain("Old parent");
            expect(frame()).not.toContain("Needle sub");
        });

        it("D on a subtask shows no toggle and no subtask phrase", async () => {
            const { test, flat, settle, selectRow, enterArchive } = await archiveSetup();
            await enterArchive();
            await selectRow("First sub");

            test.mockInput.pressKey("D");
            await settle();
            expect(flat()).toContain(
                "Permanently delete this task, their sessions, and all logs. This cannot be undone.",
            );
            expect(flat()).not.toContain("Also delete worktree");
        });

        it("D on a remote machine sends nothing", async () => {
            const { test, footer, flat, sent, settle, selectRow, enterArchive } =
                await archiveSetup(false);
            await enterArchive();
            await selectRow("Plain archived");

            test.mockInput.pressKey("D");
            await settle();
            expect(footer()).toContain("Only available on this machine.");
            expect(flat()).not.toContain("Permanently delete");
            expect(sent(MSG.TASK_DELETE)).toEqual([]);
        });

        it("D sends nothing for a row another client restored meanwhile", async () => {
            const { test, net, frame, sent, settle, selectRow, enterArchive } =
                await archiveSetup();
            await enterArchive();
            await selectRow("Plain archived");
            // Another client restored a2: the backend holds it as an active task now.
            net.responses.set(MSG.TASK_LIST_ARCHIVED, {
                tasks: archivedTasks().filter((candidate) => candidate.id !== "a2"),
            });

            test.mockInput.pressKey("D");
            await settle();
            test.mockInput.pressEnter();
            await settle();
            await settle();

            expect(sent(MSG.TASK_DELETE)).toEqual([]);
            expect(frame()).toContain("This task is no longer archived.");
            expect(frame()).not.toContain("Plain archived");
            expect(frame()).not.toContain("Permanently delete");
        });

        it("re-entering the archive offers no rows from the previous visit until it loads", async () => {
            const { test, net, app, sent, settle, enterArchive } = await archiveSetup();
            await enterArchive();
            test.mockInput.pressKey("A");
            await settle();
            // The next load is still in flight when D is pressed.
            net.responses.set(MSG.TASK_LIST_ARCHIVED, new Promise(() => undefined));

            await enterArchive();
            for (let step = 0; step < 10; step++) {
                test.mockInput.pressArrow("down");
                await settle();
            }
            expect(app.selectedOwner.kind).not.toBe("task");
            test.mockInput.pressKey("D");
            await settle();
            test.mockInput.pressKey("y");
            await settle();
            test.mockInput.pressEnter();
            await settle();

            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(2);
            expect(sent(MSG.TASK_DELETE)).toEqual([]);
        });

        it("reloads the archive on reconnect only while in archive mode", async () => {
            const { net, sent, settle, enterArchive } = await archiveSetup();
            net.emitStatus(true);
            await settle();
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(0);

            await enterArchive();
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(1);
            net.emitStatus(true);
            await settle();
            expect(sent(MSG.TASK_LIST_ARCHIVED)).toHaveLength(2);
        });
    });

    describe("while the machine is offline", () => {
        async function offlineSetup(width = 100) {
            const test = await createTestRenderer({ width, height: 24, kittyKeyboard: true });
            const inner = new FakeNet();
            inner.responses.set(MSG.TASK_LOG_LIST, { entries: [] });
            inner.responses.set(MSG.TASK_CREATE, task("new-task", "p1", "New task"));
            inner.responses.set(MSG.GIT_STATUS, {
                status: {
                    branch: "main",
                    ahead: 0,
                    behind: 0,
                    stagedFiles: [],
                    unstagedFiles: [{ path: "file.ts", status: "modified", staged: false }],
                },
            });
            inner.responses.set(MSG.GIT_DIFF_FILE, { unstaged: "@@ -1 +1 @@\n-old\n+new" });
            inner.responses.set(MSG.GIT_STAGE, {});
            inner.responses.set(MSG.SESSION_INPUT, {});
            inner.responses.set(MSG.TERMINAL_RESIZE, {});
            const guard = new OfflineGuardNet(inner);
            const store = new FakeStore();
            store.projects = [project("p1", "Project")];
            store.tasks = [{ ...task("t1", "p1", "Task"), description: "Cached description" }];
            const taskStore = new TaskDetailStore(guard);
            const gitStore = new GitStore(guard);
            const app = new OpenTuiApp({
                renderer: test.renderer,
                local: true,
                net: guard,
                store,
                taskStore,
                gitStore,
                machineLabel: "Studio Mac",
            });
            await app.init();
            cleanups.push(
                () => app.destroy(),
                () => taskStore.dispose(),
                () => gitStore.dispose(),
                () => test.renderer.destroy(),
            );
            const goOffline = async (): Promise<void> => {
                guard.offline = true;
                app.setMachineStatus({ state: "offline", reason: "ssh exited" });
                await test.renderOnce();
            };
            const settle = async (): Promise<void> => {
                await Bun.sleep(1);
                await test.renderOnce();
            };
            return { test, inner, guard, app, goOffline, settle };
        }

        function sent(net: FakeNet, type: string): number {
            return net.requests.filter((request) => request.type === type).length;
        }

        function occurrences(frame: string, text: string): number {
            return frame.split(text).length - 1;
        }

        it("shows the offline reason in the title and still opens a cached task", async () => {
            const { test, app, goOffline, settle } = await offlineSetup();
            await goOffline();
            expect(test.captureCharFrame().split("\n")[0]).toContain(
                "Studio Mac offline: ssh exited",
            );

            test.mockInput.pressArrow("down");
            test.mockInput.pressArrow("down");
            test.mockInput.pressKey("t");
            await settle();
            expect(test.captureCharFrame()).toContain("Cached description");

            app.setMachineStatus({ state: "online" });
            await test.renderOnce();
            const frame = test.captureCharFrame();
            expect(frame.split("\n")[0]).toContain("Studio Mac");
            expect(frame).not.toContain("offline: ssh exited");
            expect(frame).not.toContain("Studio Mac is offline.");
        });

        it("sends no task create and shows the offline notice", async () => {
            const { test, inner, goOffline, settle } = await offlineSetup();
            await goOffline();
            test.mockInput.pressArrow("down");
            test.mockInput.pressKey("n");
            await test.mockInput.typeText("New task");
            test.mockInput.pressArrow("down");
            await test.mockInput.typeText("Do work");
            test.mockInput.pressEnter();
            await settle();

            expect(sent(inner, MSG.TASK_CREATE)).toBe(0);
            expect(test.captureCharFrame()).toContain("Studio Mac is offline.");
        });

        it("sends no Git stage from the changes view", async () => {
            const { test, inner, goOffline, settle } = await offlineSetup();
            test.mockInput.pressArrow("down");
            test.mockInput.pressKey("g");
            await settle();
            expect(test.captureCharFrame()).toContain("file.ts");

            await goOffline();
            test.mockInput.pressKey("s");
            await settle();
            expect(sent(inner, MSG.GIT_STAGE)).toBe(0);
            expect(test.captureCharFrame()).toContain("Studio Mac is offline.");
        });

        it("keeps typed keys from a focused session and says so once", async () => {
            const { test, inner, guard, app, goOffline, settle } = await offlineSetup();
            const bridge = new SessionBridge({
                renderer: test.renderer,
                net: guard,
                sessionId: "s1",
                owner: {},
                cols: 40,
                rows: 10,
            });
            app.setSessions([{ id: "s1", label: "shell", bridge }]);
            test.mockInput.pressEnter();
            expect(app.focus).toBe("session");

            await goOffline();
            inner.requests.length = 0;
            test.mockInput.pressKey("x");
            test.mockInput.pressKey("y");
            await settle();

            expect(sent(inner, MSG.SESSION_INPUT)).toBe(0);
            expect(occurrences(test.captureCharFrame(), "Studio Mac is offline.")).toBe(1);
            expect(app.focus).toBe("session");
        });
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
