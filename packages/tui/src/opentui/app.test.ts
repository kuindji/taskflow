import { afterEach, describe, expect, it } from "bun:test";
import { BoxRenderable, type CliRenderer } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Project, Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { OpenTuiApp, cleanLabel, type SessionBridgeLike, type StoreLike } from "./app";

class FakeNet implements NetLike {
    private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statuses = new Set<(status: { connected: boolean }) => void>();
    clients = 1;

    async request<T>(type: string): Promise<T> {
        if (type === MSG.SYSTEM_CLIENTS) return { count: this.clients } as T;
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
}

class FakeStore implements StoreLike {
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

    async function setup(width = 80, height = 24, withSessions = false) {
        const test = await createTestRenderer({ width, height, kittyKeyboard: true });
        const net = new FakeNet();
        const store = new FakeStore();
        store.projects = [project("p1", "Project", 12)];
        store.tasks = [task("t1", "p1", "Task", 2)];
        const sessions = withSessions
            ? [fakeBridge(test.renderer, "one"), fakeBridge(test.renderer, "two")]
            : [];
        const app = new OpenTuiApp({ renderer: test.renderer, net, store, sessions });
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
        expect(frame).toContain("Project");
        expect(frame).toContain("12");
        expect(frame).toContain("  Task");
        expect(frame).toContain("2");
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
        expect(test.captureCharFrame()).toContain("Task 7");
    });

    it("selects sidebar rows and visible tabs at their rendered cells", async () => {
        const { test, app, sessions } = await setup(80, 24, true);
        await test.mockMouse.click(2, 1);
        expect(app.selectedIndex).toBe(1);
        await test.mockMouse.click(33, 0);
        expect(app.focus).toBe("session");
        expect(sessions[1]?.calls).toContain("focus");
        await test.mockMouse.click(2, 1);
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
});
