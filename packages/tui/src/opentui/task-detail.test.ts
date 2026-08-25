import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Project, ResolvedAttribute, Task, TaskLogEntry } from "@taskflow/shared";
import { TaskDetail } from "./task-detail";

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

const project: Project = {
    id: "p1",
    name: "Taskflow",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "",
};
const task: Task = {
    id: "t1",
    projectId: "p1",
    title: "Workspace operations",
    description: "Build task detail",
    notes: "Keep the terminal clean",
    worktree: { enabled: true, path: "/repo-task", branch: "task", pr: null },
    sessions: [],
    attributes: [{ id: "a2", name: "owner", value: "tui" }],
    createdAt: "",
    status: "active",
    archivedAt: null,
    pinned: true,
};
const attributes: ResolvedAttribute[] = [
    { id: "a1", name: "env", value: "dev", scope: "project" },
    { id: "a2", name: "owner", value: "tui", scope: "task" },
];
const logs: TaskLogEntry[] = [
    {
        id: "l1",
        sessionId: "s1",
        timestamp: "2026-08-25T10:00:00.000Z",
        type: "info",
        message: "Started",
    },
];

describe("TaskDetail", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("renders task context, scoped attributes, and activity", async () => {
        const test = await createTestRenderer({ width: 90, height: 24 });
        const view = new TaskDetail({
            renderer: test.renderer,
            task,
            project,
            attributes,
            logs,
            onEditTitle: () => undefined,
            onEditDescription: () => undefined,
            onEditNotes: () => undefined,
            onCreateAttribute: () => undefined,
            onUpdateAttribute: () => undefined,
            onDeleteAttribute: () => undefined,
            onTogglePin: () => undefined,
            onArchive: () => undefined,
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        await test.renderOnce();
        const frame = test.captureCharFrame();
        expect(frame).toContain("Workspace operations  [pinned]");
        expect(frame).toContain("Worktree: /repo-task");
        expect(frame).toContain("env = dev  (project)  [read-only]");
        expect(frame).toContain("owner = tui  (task)");
        expect(frame).toContain("info  Started");
    });

    test("routes edit, pin, archive, and close keys but consumes them while pending", async () => {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const calls: string[] = [];
        const view = new TaskDetail({
            renderer: test.renderer,
            task,
            project,
            attributes,
            logs,
            onEditTitle: () => calls.push("title"),
            onEditDescription: () => calls.push("description"),
            onEditNotes: () => calls.push("notes"),
            onCreateAttribute: () => calls.push("create-attribute"),
            onUpdateAttribute: () => calls.push("update-attribute"),
            onDeleteAttribute: () => calls.push("delete-attribute"),
            onTogglePin: () => calls.push("pin"),
            onArchive: () => calls.push("archive"),
            onClose: () => calls.push("close"),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("e"));
        view.handleKey(key("o"));
        view.handleKey(key("p"));
        view.handleKey(key("a"));
        view.handleKey(key("escape", "\x1b"));
        expect(calls).toEqual(["description", "notes", "pin", "archive", "close"]);
        view.setPending(true);
        view.handleKey(key("a"));
        expect(calls).toHaveLength(5);
    });

    test("keeps inherited attributes read-only and edits task-owned fields", async () => {
        const test = await createTestRenderer({ width: 90, height: 24 });
        const calls: unknown[] = [];
        const view = new TaskDetail({
            renderer: test.renderer,
            task,
            project,
            attributes,
            logs,
            onEditTitle: (value) => calls.push(["title", value]),
            onEditDescription: () => undefined,
            onEditNotes: () => undefined,
            onCreateAttribute: (name, value) => calls.push(["create", name, value]),
            onUpdateAttribute: (attribute, value) =>
                calls.push(["update", attribute.id, value]),
            onDeleteAttribute: (attribute) => calls.push(["delete", attribute.id]),
            onTogglePin: () => undefined,
            onArchive: () => undefined,
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());

        view.handleKey(key("u"));
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Inherited attributes are read-only.");
        expect(calls).toEqual([]);

        view.handleKey(key("down"));
        view.handleKey(key("u"));
        view.handleKey(key("x"));
        view.handleKey(key("return", "\r"));
        expect(calls).toEqual([["update", "a2", "tuix"]]);
        view.update(task, project, attributes, logs);

        view.handleKey(key("n"));
        for (const letter of "zone") view.handleKey(key(letter));
        view.handleKey(key("return", "\r"));
        for (const letter of "west") view.handleKey(key(letter));
        view.handleKey(key("return", "\r"));
        expect(calls[1]).toEqual(["create", "zone", "west"]);
        view.update(task, project, attributes, logs);

        view.handleKey(key("d"));
        expect(calls[2]).toEqual(["delete", "a2"]);
    });
});
