import { describe, expect, it } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { COMMAND_METADATA, KeyRouter, prepareForEmbeddedTerminal } from "./keys";

function key(
    name: string,
    options: Partial<ConstructorParameters<typeof KeyEvent>[0]> = {},
): KeyEvent {
    return new KeyEvent({
        name,
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        sequence: name,
        number: false,
        raw: name,
        eventType: "press",
        source: "raw",
        ...options,
    });
}

describe("KeyRouter", () => {
    it("uses the event source for Ctrl+Escape support", () => {
        const router = new KeyRouter();
        expect(router.route("session", key("escape", { ctrl: true, source: "raw" })).kind).toBe(
            "pass",
        );
        expect(router.route("session", key("escape", { ctrl: true, source: "kitty" })).kind).toBe(
            "switch-focus",
        );
    });

    it("consumes switch repeats and releases without toggling twice", () => {
        const router = new KeyRouter();
        expect(router.route("session", key("escape", { ctrl: true, source: "kitty" })).kind).toBe(
            "switch-focus",
        );
        expect(
            router.route(
                "ui",
                key("escape", { ctrl: true, source: "kitty", eventType: "repeat", repeated: true }),
            ).kind,
        ).toBe("consume");
        expect(
            router.route("ui", key("escape", { ctrl: true, source: "kitty", eventType: "release" }))
                .kind,
        ).toBe("consume");
    });

    it("holds a raw Escape for double-Escape without losing the next key", () => {
        const router = new KeyRouter();
        const escape = key("escape");
        const letter = key("x");
        expect(router.route("session", escape).kind).toBe("hold-escape");
        expect(router.route("session", letter)).toEqual({ kind: "pass", before: escape });
    });

    it("routes the Stage 1 UI commands", () => {
        const router = new KeyRouter();
        expect(router.route("ui", key("down"))).toEqual({
            kind: "command",
            command: { kind: "move", delta: 1 },
            before: undefined,
        });
        expect(router.route("ui", key("3"))).toEqual({
            kind: "command",
            command: { kind: "select-tab", index: 2 },
            before: undefined,
        });
        expect(router.route("ui", key("q", { shift: true, sequence: "Q" }))).toEqual({
            kind: "command",
            command: { kind: "quit" },
            before: undefined,
        });
        expect(router.route("ui", key("r"))).toEqual({
            kind: "command",
            command: { kind: "resume" },
            before: undefined,
        });
        expect(router.route("ui", key("f"))).toEqual({
            kind: "command",
            command: { kind: "flows" },
            before: undefined,
        });
        expect(router.route("ui", key("c"))).toEqual({
            kind: "command",
            command: { kind: "schedules" },
            before: undefined,
        });
        expect(router.route("ui", key("t"))).toEqual({
            kind: "command",
            command: { kind: "task-detail" },
            before: undefined,
        });
        expect(router.route("ui", key("n"))).toEqual({
            kind: "command",
            command: { kind: "task-create" },
            before: undefined,
        });
        expect(router.route("ui", key("g"))).toEqual({
            kind: "command",
            command: { kind: "git" },
            before: undefined,
        });
        expect(router.route("ui", key(","))).toEqual({
            kind: "command",
            command: { kind: "settings" },
            before: undefined,
        });
        expect(router.route("ui", key("1", { shift: true, sequence: "!" }))).toEqual({
            kind: "command",
            command: { kind: "notifications" },
            before: undefined,
        });
        expect(router.route("ui", key("/"))).toEqual({
            kind: "command",
            command: { kind: "filter" },
            before: undefined,
        });
        expect(router.route("ui", key("/", { shift: true, sequence: "?" }))).toEqual({
            kind: "command",
            command: { kind: "help" },
            before: undefined,
        });
    });

    it("keeps routed global commands in one-to-one help metadata", () => {
        const router = new KeyRouter();
        const events = [
            key("down"),
            key("return", { sequence: "\r" }),
            key("3"),
            key("z"),
            key("q", { shift: true, sequence: "Q" }),
            key("s"),
            key("q"),
            key("r"),
            key("t"),
            key("n"),
            key("f"),
            key("c"),
            key("g"),
            key(","),
            key("1", { shift: true, sequence: "!" }),
            key("/"),
            key("/", { shift: true, sequence: "?" }),
        ];
        const routedKinds = events.flatMap((event) => {
            const route = router.route("ui", event);
            return route.kind === "command" ? [route.command.kind] : [];
        });
        const metadataKinds = COMMAND_METADATA.map((command) => command.kind);
        expect(new Set(metadataKinds).size).toBe(metadataKinds.length);
        expect(new Set(routedKinds)).toEqual(new Set(metadataKinds));
        for (const command of COMMAND_METADATA) {
            expect(command.keys.length).toBeGreaterThan(0);
            expect(command.label.length).toBeGreaterThan(0);
            expect(command.description.length).toBeGreaterThan(0);
        }
    });

    it("adapts Kitty parser fields to OpenTUI physical keys", () => {
        const ctrlC = key("c", {
            ctrl: true,
            source: "kitty",
            code: "[99u",
            sequence: "c",
            raw: "\x1b[99;5u",
        });
        prepareForEmbeddedTerminal(ctrlC);
        expect(ctrlC.code).toBe("KeyC");
        expect(ctrlC.sequence).toBe("");

        const enter = key("return", {
            shift: true,
            source: "kitty",
            code: "[13u",
            sequence: "\x1b[13;2u",
        });
        prepareForEmbeddedTerminal(enter);
        expect(enter.code).toBe("Enter");
        expect(enter.sequence).toBe("");

        const shiftedLetter = key("q", {
            shift: true,
            source: "kitty",
            code: "[113u",
            sequence: "Q",
            raw: "\x1b[113;2u",
        });
        prepareForEmbeddedTerminal(shiftedLetter);
        expect(shiftedLetter.code).toBeUndefined();
        expect(shiftedLetter.sequence).toBe("Q");
    });

    it("replaces raw terminal escape tokens with embedded-terminal physical keys", () => {
        const up = key("up", {
            source: "raw",
            code: "[A",
            sequence: "\x1b[A",
            raw: "\x1b[A",
        });
        prepareForEmbeddedTerminal(up);
        expect(up.code).toBe("ArrowUp");

        const ctrlC = key("c", {
            ctrl: true,
            source: "raw",
            sequence: "\x03",
            raw: "\x03",
        });
        prepareForEmbeddedTerminal(ctrlC);
        expect(ctrlC.code).toBe("KeyC");
    });
});
