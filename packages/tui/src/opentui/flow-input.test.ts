import { afterEach, describe, expect, it } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { FlowInput } from "./flow-input";

function key(name: string): KeyEvent {
    return { name, sequence: name, eventType: "press" } as KeyEvent;
}

describe("FlowInput", () => {
    const cleanup: Array<() => void> = [];
    afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

    it("collects text and filepath inputs and rejects blanks", async () => {
        const renderer = await createTestRenderer({ width: 60, height: 12 });
        const submitted: Array<Record<string, string>> = [];
        const view = new FlowInput({
            renderer: renderer.renderer,
            inputs: [
                { id: "name", label: "Name", type: "text" },
                { id: "path", label: "Path", type: "filepath" },
            ],
            onCancel: () => undefined,
            onSubmit: (values) => submitted.push(values),
        });
        renderer.renderer.root.add(view.renderable);
        cleanup.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );

        view.setValue("   ");
        view.handleKey(key("enter"));
        expect(submitted).toHaveLength(0);
        view.setValue("Release");
        view.handleKey(key("enter"));
        view.setValue("/tmp/file.txt");
        view.handleKey(key("enter"));
        expect(submitted).toEqual([{ name: "Release", path: "/tmp/file.txt" }]);
    });

    it("cancels without submitting", async () => {
        const renderer = await createTestRenderer({ width: 40, height: 8 });
        let cancelled = 0;
        let submitted = 0;
        const view = new FlowInput({
            renderer: renderer.renderer,
            inputs: [{ id: "name", label: "Name", type: "text" }],
            onCancel: () => {
                cancelled += 1;
            },
            onSubmit: () => {
                submitted += 1;
            },
        });
        cleanup.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );
        view.handleKey(key("escape"));
        expect(cancelled).toBe(1);
        expect(submitted).toBe(0);
    });
});
