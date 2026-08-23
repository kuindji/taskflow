import { describe, test, expect } from "bun:test";
import { route } from "./routing";
import { noMods, type KeyEvent } from "../input/keys";

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
