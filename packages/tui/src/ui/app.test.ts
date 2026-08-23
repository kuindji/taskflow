import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Screen, type Sink } from "../render/screen";
import { Store } from "../state/store";
import { App } from "./app";
import { noMods, type KeyEvent } from "../input/keys";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) {
                return Promise.resolve({ projects: [project("p1", "Alpha")] } as T);
            }
            if (type === MSG.TASK_LIST) {
                return Promise.resolve({ tasks: [task("t1", "p1", "Build the TUI")] } as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

async function makeApp(): Promise<{ app: App; sink: Sink & { output: string } }> {
    const net = stubNet();
    const store = new Store(net);
    const sink = collectingSink();
    const app = new App({
        net,
        store,
        screen: new Screen(sink, 60, 10),
        cols: 60,
        rows: 10,
        kittyAvailable: true,
    });
    await app.init();
    return { app, sink };
}

describe("App", () => {
    test("renders project and task names on the first frame", async () => {
        const { app, sink } = await makeApp();
        app.render();
        expect(sink.output).toContain("Alpha");
        expect(sink.output).toContain("Build the TUI");
    });

    test("starts with the sidebar focused", async () => {
        const { app } = await makeApp();
        expect(app.focus).toBe("sidebar");
    });

    test("ctrl+escape toggles focus", async () => {
        const { app } = await makeApp();
        const ctrlEsc = key({ name: "escape", mods: { ...noMods(), ctrl: true } });
        app.handleKey(ctrlEsc);
        expect(app.focus).toBe("session");
        app.handleKey(ctrlEsc);
        expect(app.focus).toBe("sidebar");
    });

    test("j and k move the sidebar selection", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.handleKey(key({ char: "j" }));
        app.render();
        expect(sink.output).not.toBe("");
    });

    test("arrow keys move the sidebar selection like j and k", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.handleKey(key({ name: "down" }));
        app.render();
        const moved = sink.output;
        expect(moved).not.toBe("");
        sink.output = "";
        app.handleKey(key({ name: "up" }));
        app.render();
        expect(sink.output).not.toBe("");
    });

    test("Q stops the app", async () => {
        const { app } = await makeApp();
        expect(app.running).toBe(true);
        app.handleKey(key({ char: "Q" }));
        expect(app.running).toBe(false);
    });

    test("a second identical frame writes nothing", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.render();
        expect(sink.output).toBe("");
    });
});
