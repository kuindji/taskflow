import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { LinkedProject, Project } from "@taskflow/shared";
import { project } from "./test-helpers";
import { LinkedProjects } from "./linked-projects";

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

describe("LinkedProjects", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    async function setup(links: LinkedProject[]) {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const self: Project = { ...project("p1", "Self Project"), linkedProjects: links };
        const projects: Project[] = [
            self,
            project("p2", "Linked Already"),
            { ...project("p3", "Hidden One"), hidden: true },
            project("p4", "Candidate Four"),
            project("p5", "Candidate Five"),
        ];
        const saved: LinkedProject[][] = [];
        const view = new LinkedProjects({
            renderer: test.renderer,
            project: self,
            projects,
            onSave: (next) => saved.push(next),
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, view, saved };
    }

    test("the add picker excludes the project itself, hidden and already linked projects", async () => {
        const { test, view, saved } = await setup([{ projectId: "p2", note: "shared types" }]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Linked Already");
        expect(test.captureCharFrame()).toContain("shared types");

        view.handleKey(key("a"));
        await test.renderOnce();
        const frame = test.captureCharFrame();
        expect(frame).toContain("Candidate Four");
        expect(frame).toContain("Candidate Five");
        expect(frame).not.toContain("Self Project");
        expect(frame).not.toContain("Hidden One");
        expect(frame).not.toContain("Linked Already");

        view.handleKey(key("down"));
        view.handleKey(key("return", "\r"));
        for (const char of "docs") view.handleKey(key(char));
        view.handleKey(key("return", "\r"));
        expect(saved).toEqual([
            [
                { projectId: "p2", note: "shared types" },
                { projectId: "p5", note: "docs" },
            ],
        ]);
    });

    test("editing a note sends the full updated array", async () => {
        const { view, saved } = await setup([
            { projectId: "p2", note: "old" },
            { projectId: "p4", note: "keep" },
        ]);
        view.handleKey(key("e"));
        for (let i = 0; i < 3; i++) view.handleKey(key("backspace", "\x7f"));
        for (const char of "new") view.handleKey(key(char));
        view.handleKey(key("return", "\r"));

        expect(saved).toEqual([
            [
                { projectId: "p2", note: "new" },
                { projectId: "p4", note: "keep" },
            ],
        ]);
    });

    test("removing sends the array without that link", async () => {
        const { view, saved } = await setup([
            { projectId: "p2", note: "old" },
            { projectId: "p4", note: "gone" },
        ]);
        view.handleKey(key("down"));
        view.handleKey(key("d"));

        expect(saved).toEqual([[{ projectId: "p2", note: "old" }]]);
    });

    test("shows a save error and applies the saved links", async () => {
        const { test, view } = await setup([{ projectId: "p2", note: "old" }]);
        view.handleKey(key("d"));
        expect(view.keyHints).toBe(" Saving...");
        view.setError("Could not update links: offline");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Could not update links: offline");

        view.setLinks([]);
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("No linked projects.");
    });
});
