import { describe, test, expect } from "bun:test";
import { route, routeMouse } from "./routing";
import { noMods, type KeyEvent } from "../input/keys";
import type { MouseReport } from "../input/mouse";
import { computeLayout } from "./layout";
import { tabSpans, type TabSpec } from "./session-pane";

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

const ctrlEsc = key({ name: "escape", mods: { ...noMods(), ctrl: true } });

describe("route with the kitty protocol available", () => {
    test("ctrl+escape toggles focus from the session", () => {
        expect(route("session", ctrlEsc, true, false).action).toEqual({ kind: "toggle-focus" });
    });

    test("ctrl+escape toggles focus from the sidebar", () => {
        expect(route("sidebar", ctrlEsc, true, false).action).toEqual({ kind: "toggle-focus" });
    });

    test("every other key reaches the child when the session has focus", () => {
        const ev = key({ name: "char", char: "j" });
        expect(route("session", ev, true, false).action).toEqual({
            kind: "to-child",
            events: [ev],
        });
    });

    test("a plain escape reaches the child, not the switcher", () => {
        const ev = key({ name: "escape" });
        expect(route("session", ev, true, false).action).toEqual({
            kind: "to-child",
            events: [ev],
        });
    });

    test("sidebar keys map to commands", () => {
        expect(route("sidebar", key({ char: "j" }), true, false).action).toEqual({
            kind: "move",
            delta: 1,
        });
        expect(route("sidebar", key({ char: "k" }), true, false).action).toEqual({
            kind: "move",
            delta: -1,
        });
        expect(route("sidebar", key({ name: "enter" }), true, false).action).toEqual({
            kind: "open",
        });
        expect(route("sidebar", key({ char: "z" }), true, false).action).toEqual({ kind: "zoom" });
        expect(route("sidebar", key({ char: "n" }), true, false).action).toEqual({
            kind: "new-task",
        });
        expect(route("sidebar", key({ char: "s" }), true, false).action).toEqual({
            kind: "new-session",
        });
        expect(route("sidebar", key({ char: "q" }), true, false).action).toEqual({
            kind: "close-pane",
        });
        expect(route("sidebar", key({ char: "?" }), true, false).action).toEqual({ kind: "help" });
        expect(route("sidebar", key({ char: "Q" }), true, false).action).toEqual({ kind: "quit" });
    });

    test("number keys select a session tab", () => {
        expect(route("sidebar", key({ char: "3" }), true, false).action).toEqual({
            kind: "select-tab",
            index: 2,
        });
    });

    test("an unbound sidebar key does nothing", () => {
        expect(route("sidebar", key({ char: "@" }), true, false).action).toEqual({ kind: "none" });
    });

    test("up and down arrows move the sidebar selection", () => {
        expect(route("sidebar", key({ name: "down" }), true, false).action).toEqual({
            kind: "move",
            delta: 1,
        });
        expect(route("sidebar", key({ name: "up" }), true, false).action).toEqual({
            kind: "move",
            delta: -1,
        });
    });

    test("an arrow repeat drives the sidebar like a press", () => {
        expect(route("sidebar", key({ name: "down", kind: "repeat" }), true, false).action).toEqual(
            { kind: "move", delta: 1 },
        );
    });

    test("a chorded arrow is not a sidebar move", () => {
        const ev = key({ name: "down", mods: { ...noMods(), ctrl: true } });
        expect(route("sidebar", ev, true, false).action).toEqual({ kind: "none" });
    });

    test("left and right arrows are still unbound", () => {
        expect(route("sidebar", key({ name: "left" }), true, false).action).toEqual({
            kind: "none",
        });
        expect(route("sidebar", key({ name: "right" }), true, false).action).toEqual({
            kind: "none",
        });
    });

    test("an arrow reaches the child when the session has focus", () => {
        const ev = key({ name: "down" });
        expect(route("session", ev, true, false).action).toEqual({
            kind: "to-child",
            events: [ev],
        });
    });
});

describe("route in legacy mode", () => {
    test("a first escape is held rather than acted on", () => {
        const result = route("session", key({ name: "escape" }), false, false);
        expect(result.action).toEqual({ kind: "none" });
        expect(result.pendingEscape).toBe(true);
    });

    test("a second escape toggles focus", () => {
        const result = route("session", key({ name: "escape" }), false, true);
        expect(result.action).toEqual({ kind: "toggle-focus" });
        expect(result.pendingEscape).toBe(false);
    });

    test("a non-escape key after a held escape sends both to the child, in order", () => {
        const ev = key({ char: "a" });
        const result = route("session", ev, false, true);
        expect(result.action).toEqual({
            kind: "to-child",
            events: [key({ name: "escape" }), ev],
        });
        expect(result.pendingEscape).toBe(false);
    });
});

describe("route edge cases", () => {
    test("a release is ignored and leaves a held escape held", () => {
        const result = route("session", key({ char: "a", kind: "release" }), false, true);
        expect(result.action).toEqual({ kind: "none" });
        expect(result.pendingEscape).toBe(true);
    });

    test("a key repeat drives the sidebar like a press", () => {
        expect(route("sidebar", key({ char: "j", kind: "repeat" }), true, false).action).toEqual({
            kind: "move",
            delta: 1,
        });
    });

    test("a modified sidebar char is not a command", () => {
        const ctrlJ = key({ char: "j", mods: { ...noMods(), ctrl: true } });
        expect(route("sidebar", ctrlJ, true, false).action).toEqual({ kind: "none" });
        const altJ = key({ char: "j", mods: { ...noMods(), alt: true } });
        expect(route("sidebar", altJ, true, false).action).toEqual({ kind: "none" });
    });

    test("shift is allowed on a sidebar command", () => {
        const shiftQ = key({ char: "Q", mods: { ...noMods(), shift: true } });
        expect(route("sidebar", shiftQ, true, false).action).toEqual({ kind: "quit" });
    });

    test("tab selection covers 1 through 9 and stops there", () => {
        expect(route("sidebar", key({ char: "1" }), true, false).action).toEqual({
            kind: "select-tab",
            index: 0,
        });
        expect(route("sidebar", key({ char: "9" }), true, false).action).toEqual({
            kind: "select-tab",
            index: 8,
        });
        expect(route("sidebar", key({ char: "0" }), true, false).action).toEqual({ kind: "none" });
    });

    test("ctrl+escape is not the switcher in legacy mode", () => {
        const result = route("session", ctrlEsc, false, false);
        expect(result.action).toEqual({ kind: "to-child", events: [ctrlEsc] });
        expect(result.pendingEscape).toBe(false);
    });

    test("a held escape in the sidebar is discarded by the next command", () => {
        const result = route("sidebar", key({ char: "j" }), false, true);
        expect(result.action).toEqual({ kind: "move", delta: 1 });
        expect(result.pendingEscape).toBe(false);
    });

    test("a double escape toggles focus from the sidebar too", () => {
        expect(route("sidebar", key({ name: "escape" }), false, true).action).toEqual({
            kind: "toggle-focus",
        });
    });

    test("a super-modified sidebar char is not a command", () => {
        const superJ = key({ char: "j", mods: { ...noMods(), super: true } });
        expect(route("sidebar", superJ, true, false).action).toEqual({ kind: "none" });
        const superQ = key({ char: "Q", mods: { ...noMods(), super: true } });
        expect(route("sidebar", superQ, true, false).action).toEqual({ kind: "none" });
        const super3 = key({ char: "3", mods: { ...noMods(), super: true } });
        expect(route("sidebar", super3, true, false).action).toEqual({ kind: "none" });
    });

    test("a chorded enter does not open", () => {
        for (const mod of ["ctrl", "alt", "super"] as const) {
            const chord = key({ name: "enter", mods: { ...noMods(), [mod]: true } });
            expect(route("sidebar", chord, true, false).action).toEqual({ kind: "none" });
        }
        const shiftEnter = key({ name: "enter", mods: { ...noMods(), shift: true } });
        expect(route("sidebar", shiftEnter, true, false).action).toEqual({ kind: "open" });
    });

    test("ctrl+escape with an extra modifier is not the switcher", () => {
        for (const mod of ["alt", "super", "shift"] as const) {
            const chord = key({
                name: "escape",
                mods: { ...noMods(), ctrl: true, [mod]: true },
            });
            expect(route("session", chord, true, false).action).toEqual({
                kind: "to-child",
                events: [chord],
            });
            expect(route("sidebar", chord, true, false).action).toEqual({ kind: "none" });
        }
    });

    test("a modified escape does not start a legacy double-esc", () => {
        for (const mod of ["ctrl", "alt", "super", "shift"] as const) {
            const chord = key({ name: "escape", mods: { ...noMods(), [mod]: true } });
            const result = route("session", chord, false, false);
            expect(result.action).toEqual({ kind: "to-child", events: [chord] });
            expect(result.pendingEscape).toBe(false);
        }
    });

    test("kitty mode never injects a held escape into the child", () => {
        const ev = key({ char: "a" });
        const result = route("session", ev, true, true);
        expect(result.action).toEqual({ kind: "to-child", events: [ev] });
        expect(result.pendingEscape).toBe(false);
    });

    test("kitty mode clears a held escape rather than carrying it", () => {
        expect(route("sidebar", key({ char: "a", kind: "release" }), true, true)).toEqual({
            action: { kind: "none" },
            pendingEscape: false,
        });
        expect(route("sidebar", key({ name: "escape" }), true, true)).toEqual({
            action: { kind: "none" },
            pendingEscape: false,
        });
    });
});

describe("routeMouse", () => {
    const layout = computeLayout(100, 30, false);

    function at(patch: Partial<MouseReport>): MouseReport {
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

    function tabs(n: number): TabSpec[] {
        return Array.from({ length: n }, (_, i) => ({
            label: `session ${String(i + 1)}`,
            active: i === 0,
        }));
    }

    test("a click in the sidebar selects the row under it", () => {
        expect(
            routeMouse(at({ col: 5, row: 7 }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({
            kind: "select",
            index: 7,
        });
    });

    test("a click past the last row selects nothing", () => {
        expect(
            routeMouse(at({ col: 5, row: 7 }), layout, {
                rows: 3,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({
            kind: "none",
        });
    });

    test("a click on the sidebar's first row is a selection, not a tab", () => {
        expect(
            routeMouse(at({ col: 5, row: 0 }), layout, {
                rows: 20,
                tabs: tabs(2),
                warningStart: null,
            }),
        ).toEqual({
            kind: "select",
            index: 0,
        });
    });

    test("a left drag in the sidebar keeps selecting", () => {
        expect(
            routeMouse(at({ col: 5, row: 2, action: "drag" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "select", index: 2 });
    });

    test("a release in the sidebar does nothing", () => {
        expect(
            routeMouse(at({ col: 5, row: 2, action: "release" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    test("the wheel moves the sidebar selection one row", () => {
        expect(
            routeMouse(at({ col: 5, row: 2, button: "wheel-down" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "move", delta: 1 });
        expect(
            routeMouse(at({ col: 5, row: 2, button: "wheel-up" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "move", delta: -1 });
    });

    test("a horizontal wheel notch is unbound in the sidebar", () => {
        expect(
            routeMouse(at({ col: 5, row: 2, button: "wheel-left" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    // The column the sidebar ends on is the column the pane starts on, and
    // the two tests are one apart: an off-by-one in either bound hands the
    // pane's first column to the sidebar, or the sidebar's last to the pane.
    test("the sidebar owns its last column and the pane owns the first", () => {
        expect(
            routeMouse(at({ col: layout.sidebarWidth - 1, row: 5 }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "select", index: 5 });
        expect(
            routeMouse(at({ col: layout.sidebarWidth, row: 5 }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "focus", target: "session" });
    });

    test("the sidebar's columns belong to the pane while zoomed", () => {
        const zoomed = computeLayout(100, 30, true);
        expect(
            routeMouse(at({ col: 5, row: 7 }), zoomed, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({
            kind: "focus",
            target: "session",
        });
    });

    test("a click on a tab opens it and focuses the session", () => {
        expect(
            routeMouse(at({ col: layout.paneX + 1, row: 0 }), layout, {
                rows: 20,
                tabs: tabs(2),
                warningStart: null,
            }),
        ).toEqual({ kind: "open-tab", index: 0 });
    });

    test("a click on the second tab opens the second tab, whatever the first one's width", () => {
        // The point of taking TabSpec[] rather than a count: the boundary moves
        // with the label. A uniform-width guess picks the wrong tab here.
        const wide: TabSpec[] = [
            { label: "a very long session name", active: true },
            { label: "b", active: false },
        ];
        const spans = tabSpans(layout.paneWidth, wide);
        const second = spans[1];
        if (second === undefined) throw new Error("the second tab should fit in 70 columns");
        expect(
            routeMouse(at({ col: layout.paneX + second.start, row: 0 }), layout, {
                rows: 20,
                tabs: wide,
                warningStart: null,
            }),
        ).toEqual({ kind: "open-tab", index: 1 });
        expect(
            routeMouse(at({ col: layout.paneX + second.end - 1, row: 0 }), layout, {
                rows: 20,
                tabs: wide,
                warningStart: null,
            }),
        ).toEqual({ kind: "open-tab", index: 1 });
    });

    test("a click past the last tab does nothing", () => {
        expect(
            routeMouse(at({ col: layout.cols - 1, row: 0 }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    test("a drag across the tab strip does not open a tab", () => {
        expect(
            routeMouse(at({ col: layout.paneX + 1, row: 0, action: "drag" }), layout, {
                rows: 20,
                tabs: tabs(2),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    test("a click in the pane focuses the session", () => {
        expect(
            routeMouse(at({ col: layout.paneX + 3, row: 5 }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "focus", target: "session" });
    });

    test("the wheel in the pane scrolls it", () => {
        expect(
            routeMouse(at({ col: layout.paneX + 3, row: 5, button: "wheel-up" }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "scroll", delta: -3 });
        expect(
            routeMouse(at({ col: layout.paneX + 3, row: 5, button: "wheel-down" }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "scroll", delta: 3 });
    });

    test("a report below the last pane row is unbound", () => {
        expect(
            routeMouse(at({ col: layout.paneX + 3, row: layout.rows }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    test("a middle click is unbound everywhere", () => {
        expect(
            routeMouse(at({ col: 2, row: 2, button: "middle" }), layout, {
                rows: 20,
                tabs: tabs(0),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
        expect(
            routeMouse(at({ col: layout.paneX + 3, row: 5, button: "middle" }), layout, {
                rows: 20,
                tabs: tabs(1),
                warningStart: null,
            }),
        ).toEqual({ kind: "none" });
    });

    test("a click on the client warning is not a click on the tab under it", () => {
        // The banner is painted over the right of the strip, so those columns
        // show the warning rather than the tab beneath — and the click has to
        // mean what the user can see.
        const spans = tabSpans(layout.paneWidth, tabs(3));
        const third = spans[2];
        if (third === undefined) throw new Error("three tabs should fit in 70 columns");
        const col = layout.paneX + third.end - 1;
        expect(
            routeMouse(at({ col, row: 0 }), layout, {
                rows: 20,
                tabs: tabs(3),
                warningStart: null,
            }),
        ).toEqual({
            kind: "open-tab",
            index: 2,
        });
        expect(
            routeMouse(at({ col, row: 0 }), layout, { rows: 20, tabs: tabs(3), warningStart: col }),
        ).toEqual({ kind: "none" });
    });
});
