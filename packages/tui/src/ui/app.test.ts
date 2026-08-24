import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Screen, type Sink } from "../render/screen";
import { ATTR_INVERSE } from "../render/cells";
import { Store } from "../state/store";
import { App } from "./app";
import { noMods, type KeyEvent } from "../input/keys";
import type { MouseReport } from "../input/mouse";
import type { NetLike } from "../net/client";
import { SessionTerminal } from "../term/session-terminal";

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

/** A net whose broadcast handlers can be fired, so the store can be mutated mid-test. */
interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
    /** Drive the connection status the way a drop and a reconnect would. */
    setStatus(connected: boolean): void;
    /** Every SESSION_INPUT payload the app has sent, in order. */
    sent: string[];
}

function stubNet(projects: Project[], tasks: Task[], clients = 1): FakeNet {
    const handlers = new Map<string, ((payload: unknown) => void)[]>();
    const statusListeners = new Set<(status: { connected: boolean }) => void>();
    return {
        sent: [],
        request<T>(type: string, payload?: unknown): Promise<T> {
            // Copies, not the arrays themselves: a real snapshot arrives over the
            // socket, so the store must not end up sharing a test's fixture.
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects: [...projects] } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks: [...tasks] } as T);
            if (type === MSG.SYSTEM_CLIENTS) return Promise.resolve({ count: clients } as T);
            if (type === MSG.SESSION_INPUT) {
                const data = (payload as { data?: unknown }).data;
                this.sent.push(typeof data === "string" ? data : "");
            }
            return Promise.resolve({} as T);
        },
        on(type: string, handler: (payload: unknown) => void) {
            const list = handlers.get(type) ?? [];
            list.push(handler);
            handlers.set(type, list);
            return () => undefined;
        },
        onStatusChange(listener: (status: { connected: boolean }) => void) {
            statusListeners.add(listener);
            return () => statusListeners.delete(listener);
        },
        setStatus(connected: boolean) {
            for (const listener of statusListeners) listener({ connected });
        },
        emit(type: string, payload: unknown) {
            for (const handler of handlers.get(type) ?? []) handler(payload);
        },
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

function mouse(patch: Partial<MouseReport>): MouseReport {
    return {
        kind: "mouse",
        action: "press",
        button: "left",
        col: 0,
        row: 0,
        mods: noMods(),
        ...patch,
    };
}

/** Two projects and two tasks: Alpha, One, Beta, Two — four sidebar rows. */
function fourRows(): Promise<{
    app: App;
    sink: Sink & { output: string };
    screen: Screen;
    net: FakeNet;
}> {
    return makeApp(
        [project("p1", "Alpha"), project("p2", "Beta")],
        [task("t1", "p1", "One"), task("t2", "p2", "Two")],
    );
}

async function makeApp(
    projects: Project[] = [project("p1", "Alpha")],
    tasks: Task[] = [task("t1", "p1", "Build the TUI")],
    clients = 1,
): Promise<{
    app: App;
    sink: Sink & { output: string };
    screen: Screen;
    net: FakeNet;
    tasks: Task[];
}> {
    const net = stubNet(projects, tasks, clients);
    const store = new Store(net);
    const sink = collectingSink();
    const screen = new Screen(sink, 60, 10);
    const app = new App({
        net,
        store,
        screen,
        cols: 60,
        rows: 10,
        kittyAvailable: true,
    });
    await app.init();
    return { app, sink, screen, net, tasks };
}

/**
 * The row the sidebar drew as selected, read off the painted frame. `render()`
 * leaves `back` holding what was just flushed, and the selection is the one row
 * drawn in inverse video — so this pins the selection itself rather than the
 * fact that something, anything, was repainted.
 */
function selectedRow(screen: Screen): number | null {
    for (let y = 0; y < screen.back.rows; y++) {
        if ((screen.back.get(0, y).attrs & ATTR_INVERSE) !== 0) return y;
    }
    return null;
}

describe("App", () => {
    test("reloads the store on reconnect so the sidebar is not left stale", async () => {
        const { app, sink, net, tasks } = await makeApp();
        app.render();
        expect(sink.output).toContain("Build the TUI");

        // The outage: the backend broadcasts nothing to a client that is gone,
        // so a task another client adds here never reaches the store.
        net.setStatus(false);
        tasks.push(task("t2", "p1", "Latecomer"));
        net.setStatus(true);
        // Let the reload's PROJECT_LIST/TASK_LIST round-trip settle.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        sink.output = "";
        app.render();
        expect(sink.output).toContain("Latecomer");
    });

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
        const { app, screen } = await makeApp();
        app.render();
        expect(selectedRow(screen)).toBe(0);
        app.handleKey(key({ char: "j" }));
        app.render();
        expect(selectedRow(screen)).toBe(1);
        app.handleKey(key({ char: "k" }));
        app.render();
        expect(selectedRow(screen)).toBe(0);
    });

    test("arrow keys move the sidebar selection like j and k", async () => {
        const { app, screen } = await makeApp();
        app.render();
        expect(selectedRow(screen)).toBe(0);
        app.handleKey(key({ name: "down" }));
        app.render();
        expect(selectedRow(screen)).toBe(1);
        app.handleKey(key({ name: "up" }));
        app.render();
        expect(selectedRow(screen)).toBe(0);
    });

    test("keeps a selection when the row list shrinks under it", async () => {
        const { app, screen, net } = await makeApp(
            [project("p1", "Alpha"), project("p2", "Beta")],
            [task("t1", "p1", "One"), task("t2", "p2", "Two")],
        );
        // Alpha, One, Beta, Two — move down onto the last row.
        for (let i = 0; i < 3; i++) app.handleKey(key({ char: "j" }));
        app.render();
        expect(selectedRow(screen)).toBe(3);

        // Beta is removed on the backend, taking rows 2 and 3 with it.
        net.emit(MSG.PROJECT_REMOVED, { id: "p2" });
        app.render();
        expect(selectedRow(screen)).toBe(1);
    });

    test("Q stops the app", async () => {
        const { app } = await makeApp();
        expect(app.running).toBe(true);
        app.handleKey(key({ char: "Q" }));
        expect(app.running).toBe(false);
    });

    test("a click on a sidebar row moves the selection there", async () => {
        const { app, screen } = await fourRows();
        app.render();
        expect(selectedRow(screen)).toBe(0);
        app.handleMouse(mouse({ col: 2, row: 3 }));
        app.render();
        expect(selectedRow(screen)).toBe(3);
    });

    test("a click on a sidebar row also takes focus back from the session", async () => {
        const { app } = await fourRows();
        app.handleKey(key({ name: "escape", mods: { ...noMods(), ctrl: true } }));
        expect(app.focus).toBe("session");
        app.handleMouse(mouse({ col: 2, row: 1 }));
        expect(app.focus).toBe("sidebar");
    });

    test("a click past the last row leaves the selection alone", async () => {
        const { app, screen } = await fourRows();
        app.handleMouse(mouse({ col: 2, row: 2 }));
        app.render();
        expect(selectedRow(screen)).toBe(2);
        // Four rows are drawn into a ten-row sidebar; row 7 is inside the
        // sidebar's columns but past the end of the list.
        app.handleMouse(mouse({ col: 2, row: 7 }));
        app.render();
        expect(selectedRow(screen)).toBe(2);
    });

    test("a click in the pane focuses the session", async () => {
        const { app } = await makeApp();
        expect(app.focus).toBe("sidebar");
        app.handleMouse(mouse({ col: 40, row: 5 }));
        expect(app.focus).toBe("session");
    });

    test("the wheel over the sidebar moves the selection", async () => {
        const { app, screen } = await fourRows();
        app.handleMouse(mouse({ col: 2, row: 0, button: "wheel-down" }));
        app.handleMouse(mouse({ col: 2, row: 0, button: "wheel-down" }));
        app.render();
        expect(selectedRow(screen)).toBe(2);
        app.handleMouse(mouse({ col: 2, row: 0, button: "wheel-up" }));
        app.render();
        expect(selectedRow(screen)).toBe(1);
    });

    test("the wheel stops at the ends of the row list", async () => {
        const { app, screen } = await fourRows();
        for (let i = 0; i < 8; i++) app.handleMouse(mouse({ col: 2, button: "wheel-down" }));
        app.render();
        expect(selectedRow(screen)).toBe(3);

        // Overshoot is dropped notch by notch, not carried. Deliberately not
        // rendered in between: the frame re-clamps the selection on its own, so
        // a frame between the two runs would hide an unclamped move entirely.
        for (let i = 0; i < 8; i++) app.handleMouse(mouse({ col: 2, button: "wheel-down" }));
        app.handleMouse(mouse({ col: 2, button: "wheel-up" }));
        app.render();
        expect(selectedRow(screen)).toBe(2);

        for (let i = 0; i < 8; i++) app.handleMouse(mouse({ col: 2, button: "wheel-up" }));
        app.handleMouse(mouse({ col: 2, button: "wheel-down" }));
        app.render();
        expect(selectedRow(screen)).toBe(1);
    });

    test("the wheel over an empty pane is harmless", async () => {
        const { app, screen } = await fourRows();
        app.handleMouse(mouse({ col: 2, row: 1 }));
        app.render();
        // No session is open in Stage 1, so there is nothing to scroll and the
        // sidebar's selection must not move on the pane's behalf.
        app.handleMouse(mouse({ col: 40, row: 5, button: "wheel-up" }));
        app.render();
        expect(selectedRow(screen)).toBe(1);
    });

    test("a second identical frame writes nothing", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.render();
        expect(sink.output).toBe("");
    });

    /**
     * A child terminal in a mouse mode, installed into `App`'s private
     * `sessions` array by element access. Stage 1 has no `SESSION_CREATE` and
     * no other way to open a session; adding a constructor parameter whose only
     * caller is a test would put dead surface in the shipped API. Stage 2's
     * real path replaces this seam and these tests move onto it.
     *
     * `enable` is the child's own output, so the modes come from the same
     * mode-tracking path production uses rather than from a stub.
     */
    async function openSession(
        app: App,
        enable: string,
        size: { cols: number; rows: number } = { cols: 34, rows: 9 },
    ): Promise<SessionTerminal> {
        const net: NetLike = {
            request: <T>() => Promise.resolve({} as T),
            on: () => () => undefined,
            onStatusChange: () => () => undefined,
        };
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, ...size });
        await new Promise<void>((resolve) => {
            term.terminal.write(enable, resolve);
        });
        app["sessions"].push({ id: "s1", term });
        return term;
    }

    test("a click in the pane reaches a child that asked for the mouse", async () => {
        const { app, net } = await fourRows();
        // ?1000h is vt200 tracking; ?1006h is SGR encoding.
        const term = await openSession(app, "\x1b[?1000h\x1b[?1006h");
        expect(term.modes.mouseTracking).toBe("vt200");

        // 60x10, sidebar 20 wide, pane at (20, 1). Screen (26, 4) is the
        // child's own (6, 3), which is (7, 4) one-based on the wire.
        app.handleMouse(mouse({ col: 26, row: 4 }));
        expect(net.sent).toEqual(["\x1b[<0;7;4M"]);
        expect(app.focus).toBe("session");
        term.dispose();
    });

    test("a click in the pane never reaches a child that did not", async () => {
        const { app, net } = await fourRows();
        // No seam needed: with `sessions` empty the guard falls through to
        // routeMouse, which only moves focus.
        app.handleMouse(mouse({ col: 26, row: 4 }));
        expect(net.sent).toEqual([]);
        expect(app.focus).toBe("session");
    });

    test("a child that tracks nothing leaves the pane's own bindings alone", async () => {
        const { app, net } = await fourRows();
        // Twenty lines into a nine-row pane, so there is scrollback to move.
        const term = await openSession(app, "L1\r\n".repeat(20));
        expect(term.modes.mouseTracking).toBe("none");

        // The wheel is the discriminator: a report the child does not want must
        // reach routeMouse, which scrolls the pane and leaves focus where it is.
        // Swallowing it in the forwarding branch would do neither.
        const base = term.terminal.buffer.active.baseY;
        app.handleMouse(mouse({ col: 26, row: 4, button: "wheel-up" }));
        expect(net.sent).toEqual([]);
        expect(term.terminal.buffer.active.viewportY).toBe(base - 3);
        expect(app.focus).toBe("sidebar");

        // A click still focuses the pane — that is routeMouse's doing, not the
        // forwarding branch's.
        app.handleMouse(mouse({ col: 26, row: 4 }));
        expect(net.sent).toEqual([]);
        expect(app.focus).toBe("session");
        term.dispose();
    });

    test("a click past the child's own width is dropped", async () => {
        const { app, net } = await fourRows();
        // The child is 4x2 while the pane is 40x9 — the gap a resize opens for
        // a frame. Screen (24, 2) is the child's (4, 1), one past its last column.
        const term = await openSession(app, "\x1b[?1000h\x1b[?1006h", { cols: 4, rows: 2 });
        app.handleMouse(mouse({ col: 24, row: 2 }));
        expect(net.sent).toEqual([]);
        // And one past its last row.
        app.handleMouse(mouse({ col: 20, row: 3 }));
        expect(net.sent).toEqual([]);
        // The cell just inside both still arrives.
        app.handleMouse(mouse({ col: 23, row: 2 }));
        expect(net.sent).toEqual(["\x1b[<0;4;2M"]);
        term.dispose();
    });

    test("the wheel over a pane whose child wants the mouse goes to the child", async () => {
        const { app, net, screen } = await fourRows();
        const term = await openSession(app, "\x1b[?1000h\x1b[?1006h");
        app.handleMouse(mouse({ col: 26, row: 4, button: "wheel-up" }));
        // Button 64 is a wheel-up press, not a scrollback move the UI kept.
        expect(net.sent).toEqual(["\x1b[<64;7;4M"]);
        app.render();
        expect(selectedRow(screen)).toBe(0);
        term.dispose();
    });

    test("the sidebar keeps its last column from a child that wants the mouse", async () => {
        const { app, net, screen } = await fourRows();
        const term = await openSession(app, "\x1b[?1000h\x1b[?1006h");
        // Column 19 is the sidebar's last at 60 columns; the pane starts at 20.
        // The forwarding guard runs before routeMouse, so a pane rect one column
        // too wide would hand this click to the child and the row would not move.
        app.handleMouse(mouse({ col: 19, row: 2 }));
        expect(net.sent).toEqual([]);
        app.render();
        expect(selectedRow(screen)).toBe(2);
        expect(app.focus).toBe("sidebar");
        term.dispose();
    });
    /**
     * A session whose net records every request type, so an attach triggered
     * from `App` can be counted. Installed through the same private-array seam
     * as `openSession` and for the same reason.
     */
    function openCountingSession(app: App, id: string): { term: SessionTerminal; types: string[] } {
        const types: string[] = [];
        const net: NetLike = {
            request: <T>(type: string) => {
                types.push(type);
                return Promise.resolve({ snapshot: null, kittyStack: [], history: "" } as T);
            },
            on: () => () => undefined,
            onStatusChange: () => () => undefined,
        };
        const term = new SessionTerminal({ net, sessionId: id, owner: {}, cols: 34, rows: 9 });
        app["sessions"].push({ id, term });
        return { term, types };
    }

    test("re-attaches every open session on reconnect", async () => {
        const { app, net } = await makeApp();
        const first = openCountingSession(app, "s1");
        const second = openCountingSession(app, "s2");

        net.setStatus(false);
        net.setStatus(true);
        // Let the attach round-trips settle.
        for (let i = 0; i < 5; i++) await Promise.resolve();

        expect(first.types).toContain(MSG.SESSION_SNAPSHOT);
        expect(second.types).toContain(MSG.SESSION_SNAPSHOT);
        first.term.dispose();
        second.term.dispose();
    });

    test("a reconnect survives a session whose attach rejects", async () => {
        const { app, net } = await makeApp();
        const failing: NetLike = {
            request: <T>() => Promise.reject<T>(new Error("gone")),
            on: () => () => undefined,
            onStatusChange: () => () => undefined,
        };
        const term = new SessionTerminal({
            net: failing,
            sessionId: "s1",
            owner: {},
            cols: 34,
            rows: 9,
        });
        app["sessions"].push({ id: "s1", term });
        const healthy = openCountingSession(app, "s2");

        net.setStatus(false);
        net.setStatus(true);
        for (let i = 0; i < 5; i++) await Promise.resolve();

        // The rejection is swallowed, and the session behind it still attaches.
        expect(healthy.types).toContain(MSG.SESSION_SNAPSHOT);
        term.dispose();
        healthy.term.dispose();
    });

    /** The banner text drawn on the tab row, trimmed of the blank cells around it. */
    function tabRowText(screen: Screen): string {
        let out = "";
        for (let x = 0; x < screen.back.cols; x++) out += screen.back.get(x, 0).ch;
        return out;
    }

    test("warns when another client is attached to the same backend", async () => {
        const { app, net, screen } = await makeApp();
        net.emit(MSG.SYSTEM_CLIENTS, { count: 3 });
        app.render();
        expect(tabRowText(screen)).toContain("2 other client(s) attached");
    });

    test("warns about a client that was already attached before the TUI started", async () => {
        // The backend announces the count on every connect, but the frame
        // arrives in the same turn as the socket open — before init() can
        // subscribe. Only the fetch in init() sees it, so without that fetch
        // this warning never appears for the case it exists for.
        const { app, screen } = await makeApp(undefined, undefined, 2);
        app.render();
        expect(tabRowText(screen)).toContain("1 other client(s) attached");
    });

    test("a broadcast that lands during init outranks the fetched count", async () => {
        const { app, net, screen } = await makeApp(undefined, undefined, 2);
        net.emit(MSG.SYSTEM_CLIENTS, { count: 4 });
        app.render();
        expect(tabRowText(screen)).toContain("3 other client(s) attached");
    });

    test("says nothing when this client is the only one", async () => {
        const { app, net, screen } = await makeApp();
        net.emit(MSG.SYSTEM_CLIENTS, { count: 1 });
        app.render();
        expect(tabRowText(screen)).not.toContain("other client(s) attached");
    });

    test("a count of zero does not render a negative client count", async () => {
        const { app, net, screen } = await makeApp();
        // The backend counts this client too, so 0 should not happen — but a
        // count that lags a disconnect must not print "-1 other client(s)".
        net.emit(MSG.SYSTEM_CLIENTS, { count: 0 });
        app.render();
        expect(tabRowText(screen)).not.toContain("other client(s) attached");
    });

    test("the warning is drawn in inverse video at the right of the tab row", async () => {
        const { app, net, screen } = await makeApp();
        net.emit(MSG.SYSTEM_CLIENTS, { count: 2 });
        app.render();
        // 60 columns, and the banner ends flush with the last one.
        const last = screen.back.get(59, 0);
        expect(last.ch).toBe(" ");
        expect(last.attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
        expect(screen.back.get(58, 0).ch).toBe("d");
    });

    test("the warning clears once the other client leaves", async () => {
        const { app, net, screen } = await makeApp();
        net.emit(MSG.SYSTEM_CLIENTS, { count: 2 });
        app.render();
        expect(tabRowText(screen)).toContain("1 other client(s) attached");

        net.emit(MSG.SYSTEM_CLIENTS, { count: 1 });
        app.render();
        expect(tabRowText(screen)).not.toContain("other client(s) attached");
    });

    test("a click on the client warning does not reach the tab under it", async () => {
        // The banner is painted over the right of the tab strip, so a column
        // showing "attached" is a column the user cannot see a tab in. Routing
        // it as a tab switches the pane to a session the user never clicked.
        const { app, net, screen } = await makeApp();
        const first = openCountingSession(app, "s1");
        const second = openCountingSession(app, "s2");
        const third = openCountingSession(app, "s3");
        net.emit(MSG.SYSTEM_CLIENTS, { count: 2 });
        app.render();

        const banner = tabRowText(screen).indexOf("attached");
        expect(banner).toBeGreaterThan(-1);
        expect(app["activeSession"]).toBe(0);
        app.handleMouse(mouse({ col: banner + 1, row: 0 }));
        expect(app["activeSession"]).toBe(0);

        first.term.dispose();
        second.term.dispose();
        third.term.dispose();
    });
});
