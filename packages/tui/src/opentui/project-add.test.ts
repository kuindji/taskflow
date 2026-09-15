import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { ProjectAdd, type ProjectAddDeps } from "./project-add";

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

function type(view: ProjectAdd, text: string): void {
    for (const char of text) view.handleKey(key(char));
}

describe("ProjectAdd", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    async function setup(extra: Partial<ProjectAddDeps> = {}) {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const submitted: Array<{ path: string; name?: string }> = [];
        const view = new ProjectAdd({
            renderer: test.renderer,
            onCancel: () => undefined,
            onSubmit: (path, name) =>
                submitted.push(name === undefined ? { path } : { path, name }),
            ...extra,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, view, submitted };
    }

    test("an empty path blocks submit", async () => {
        const { test, view, submitted } = await setup();
        type(view, "   ");
        view.handleKey(key("return", "\r"));
        await test.renderOnce();

        expect(submitted).toEqual([]);
        expect(test.captureCharFrame()).toContain("A path is required.");
    });

    test("submits the trimmed path and the optional name", async () => {
        const { view, submitted } = await setup();
        type(view, "/tmp/app ");
        view.handleKey(key("return", "\r"));
        expect(submitted).toEqual([{ path: "/tmp/app" }]);
        expect(view.keyHints).toBe(" Adding...");

        view.setError("retry");
        view.handleKey(key("down"));
        type(view, "App");
        view.handleKey(key("return", "\r"));
        expect(submitted[1]).toEqual({ path: "/tmp/app", name: "App" });
    });

    test("a backend error renders in the form and keeps the input", async () => {
        const { test, view, submitted } = await setup();
        type(view, "/etc/hosts");
        view.handleKey(key("return", "\r"));
        view.setError("Could not add project: not a directory");
        await test.renderOnce();

        const frame = test.captureCharFrame();
        expect(frame).toContain("not a directory");
        expect(frame).toContain("/etc/hosts");

        view.handleKey(key("return", "\r"));
        expect(submitted).toEqual([{ path: "/etc/hosts" }, { path: "/etc/hosts" }]);
    });

    test("Tab completes the path and lists several candidates", async () => {
        const inputs: string[] = [];
        const { test, view } = await setup({
            complete: (input) => {
                inputs.push(input);
                return Promise.resolve({ value: "~/Pro", candidates: ["Projects", "Prototypes"] });
            },
        });
        type(view, "~/P");
        view.handleKey(key("tab", "\t"));
        await Bun.sleep(1);
        await test.renderOnce();

        expect(inputs).toEqual(["~/P"]);
        const frame = test.captureCharFrame();
        expect(frame).toContain("~/Pro");
        expect(frame).toContain("Projects  Prototypes");
    });
});
