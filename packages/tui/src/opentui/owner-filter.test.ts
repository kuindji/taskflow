import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { OwnerFilter } from "./owner-filter";

function key(name: string, sequence = name): KeyEvent {
    return new KeyEvent({
        name,
        sequence,
        raw: sequence,
        eventType: "press",
        source: "raw",
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        number: false,
    });
}

describe("OwnerFilter", () => {
    const cleanups: Array<() => void> = [];

    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("edits and submits a trimmed filter", async () => {
        const renderer = await createTestRenderer({ width: 80, height: 24 });
        const submitted: string[] = [];
        const view = new OwnerFilter({
            renderer: renderer.renderer,
            initialValue: "old",
            onCancel: () => undefined,
            onSubmit: (value) => submitted.push(value),
        });
        renderer.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );

        view.handleKey(key("backspace", "\x7f"));
        view.handleKey(key("x"));
        view.handleKey(key("return", "\r"));

        expect(submitted).toEqual(["olx"]);
    });

    test("cancels without submitting", async () => {
        const renderer = await createTestRenderer({ width: 80, height: 24 });
        let cancelled = 0;
        const submitted: string[] = [];
        const view = new OwnerFilter({
            renderer: renderer.renderer,
            initialValue: "",
            onCancel: () => cancelled++,
            onSubmit: (value) => submitted.push(value),
        });
        renderer.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );

        view.handleKey(key("escape", "\x1b"));

        expect(cancelled).toBe(1);
        expect(submitted).toEqual([]);
    });
});
