import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { GitCommit } from "./git-commit";

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

describe("GitCommit", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("validates a message and submits once while pending", async () => {
        const test = await createTestRenderer({ width: 80, height: 20 });
        const messages: string[] = [];
        const view = new GitCommit({
            renderer: test.renderer,
            onCancel: () => undefined,
            onGenerate: () => undefined,
            onSubmit: (message) => messages.push(message),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("return", "\r"));
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Commit message is required.");
        for (const letter of "fix status") view.handleKey(key(letter === " " ? "space" : letter, letter));
        view.handleKey(key("return", "\r"));
        view.handleKey(key("return", "\r"));
        expect(messages).toEqual(["fix status"]);
        expect(view.keyHints).toBe(" Committing...");
    });

    test("generates only on explicit g and keeps the returned message editable", async () => {
        const test = await createTestRenderer({ width: 80, height: 20 });
        let generated = 0;
        const submitted: string[] = [];
        const view = new GitCommit({
            renderer: test.renderer,
            onCancel: () => undefined,
            onGenerate: () => generated++,
            onSubmit: (message) => submitted.push(message),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        expect(generated).toBe(0);
        view.handleKey(key("g"));
        view.handleKey(key("g"));
        expect(generated).toBe(1);
        view.setGenerated("generated message");
        view.handleKey(key("x"));
        view.handleKey(key("return", "\r"));
        expect(submitted).toEqual(["generated messagex"]);
    });
});
