import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TaskCreatePayload } from "@taskflow/shared";
import { TaskCreate } from "./task-create";

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

describe("TaskCreate", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("submits a validated top-level task once while pending", async () => {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const submitted: TaskCreatePayload[] = [];
        const view = new TaskCreate({
            renderer: test.renderer,
            projectId: "p1",
            onCancel: () => undefined,
            onSubmit: (payload) => submitted.push(payload),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.setField("title", "  New task  ");
        view.setField("description", "  Do the work  ");
        view.setField("initCommand", " bun install ");
        view.setWorktree(true);
        view.handleKey(key("return", "\r"));
        view.handleKey(key("return", "\r"));
        expect(submitted).toEqual([
            {
                projectId: "p1",
                parentId: undefined,
                title: "New task",
                description: "Do the work",
                worktree: true,
                initCommand: "bun install",
            },
        ]);
        expect(view.keyHints).toBe(" Creating...");
    });

    test("requires title and description", async () => {
        const test = await createTestRenderer({ width: 80, height: 24 });
        let submitted = 0;
        const view = new TaskCreate({
            renderer: test.renderer,
            projectId: "p1",
            onCancel: () => undefined,
            onSubmit: () => submitted++,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("return", "\r"));
        await test.renderOnce();
        expect(submitted).toBe(0);
        expect(test.captureCharFrame()).toContain("Title and description are required.");
    });

    test("creates a subtask without overriding inherited worktree fields", async () => {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const submitted: TaskCreatePayload[] = [];
        const view = new TaskCreate({
            renderer: test.renderer,
            projectId: "p1",
            parentId: "parent",
            onCancel: () => undefined,
            onSubmit: (payload) => submitted.push(payload),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.setField("title", "Child");
        view.setField("description", "Child work");
        view.setField("initCommand", "must not be sent");
        view.setWorktree(true);
        view.handleKey(key("return", "\r"));
        expect(submitted).toEqual([
            {
                projectId: "p1",
                parentId: "parent",
                title: "Child",
                description: "Child work",
                worktree: undefined,
                initCommand: undefined,
            },
        ]);
    });
});
