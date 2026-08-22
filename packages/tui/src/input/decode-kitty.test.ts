import { describe, test, expect } from "bun:test";
import { decodeKitty } from "./decode-kitty";
import { decodeLegacy } from "./decode-legacy";
import { noMods } from "./keys";

describe("decodeKitty", () => {
    test("decodes ctrl+escape, the focus switcher", () => {
        const { events } = decodeKitty("\x1b[27;5u", "");
        expect(events[0]).toEqual({
            name: "escape",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("decodes a bare character codepoint", () => {
        const { events } = decodeKitty("\x1b[97u", "");
        expect(events[0]).toEqual({ name: "char", char: "a", mods: noMods(), kind: "press" });
    });

    test("decodes shift+enter", () => {
        const { events } = decodeKitty("\x1b[13;2u", "");
        expect(events[0]).toEqual({
            name: "enter",
            mods: { ...noMods(), shift: true },
            kind: "press",
        });
    });

    test("decodes the event type when present", () => {
        expect(decodeKitty("\x1b[97;1:3u", "").events[0]?.kind).toBe("release");
        expect(decodeKitty("\x1b[97;1:2u", "").events[0]?.kind).toBe("repeat");
    });

    test("delegates non-u sequences to the legacy decoder", () => {
        expect(decodeKitty("\x1b[A", "").events[0]?.name).toBe("up");
        expect(decodeKitty("q", "").events[0]?.char).toBe("q");
    });

    test("keeps both keys when a chunk mixes legacy and kitty input", () => {
        // A single read can contain both; delegating the whole tail to the
        // legacy decoder silently swallowed the CSI-u sequence.
        const { events } = decodeKitty("q\x1b[13;2u", "");
        expect(events.map((e) => e.name)).toEqual(["char", "enter"]);
    });

    test("carries an incomplete u sequence", () => {
        const first = decodeKitty("\x1b[27;", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[27;");
        expect(decodeKitty("5u", first.carry).events[0]?.name).toBe("escape");
    });

    test("reports space the same way the legacy decoder does", () => {
        // Both decoders feed one downstream router, so one key must have one
        // shape: legacy reports space as a char event, and so does this one.
        expect(decodeKitty("\x1b[32u", "").events).toEqual(decodeLegacy(" ", "").events);
    });

    test("decodes tab and backspace by name", () => {
        expect(decodeKitty("\x1b[9u", "").events[0]?.name).toBe("tab");
        expect(decodeKitty("\x1b[127u", "").events[0]?.name).toBe("backspace");
    });

    test("keeps the shifted-key alternate out of the codepoint", () => {
        // `unicode-key-code:shifted-key:base-layout-key` — only the first
        // sub-parameter is the key that was pressed.
        const { events } = decodeKitty("\x1b[97:65;2u", "");
        expect(events[0]).toEqual({
            name: "char",
            char: "a",
            mods: { ...noMods(), shift: true },
            kind: "press",
        });
    });

    test("drops a sequence whose codepoint is out of range", () => {
        // String.fromCodePoint throws above U+10FFFF; a malformed sequence must
        // not take the input pipeline down with it.
        expect(decodeKitty("\x1b[99999999u", "").events).toEqual([]);
        expect(decodeKitty("\x1b[u", "").events).toEqual([]);
    });

    test("ignores a private-parameter reply that ends in u", () => {
        // `CSI ? 1 u` is the terminal answering the protocol query, not a key.
        expect(decodeKitty("\x1b[?1u", "").events).toEqual([]);
    });

    test("releases an escape stranded before a kitty sequence", () => {
        // The legacy chunk ends mid-sequence, but a kitty sequence follows in
        // the same read, so nothing can complete it — it must not vanish.
        const { events, carry } = decodeKitty("\x1b\x1b[13;2u", "");
        expect(events.map((e) => e.name)).toEqual(["escape", "enter"]);
        expect(carry).toBe("");
    });

    test("carries a legacy sequence that is still in flight", () => {
        const { events, carry } = decodeKitty("\x1b[13;2u\x1b[1;5", "");
        expect(events.map((e) => e.name)).toEqual(["enter"]);
        expect(carry).toBe("\x1b[1;5");
        expect(decodeKitty("A", carry).events[0]?.name).toBe("up");
    });
});
