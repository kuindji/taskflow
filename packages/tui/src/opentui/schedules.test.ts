import { afterEach, describe, expect, it } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Project, Schedule } from "@taskflow/shared";
import { READ_ONLY_BANNER, Schedules } from "./schedules";

function key(sequence: string, name = sequence): KeyEvent {
    return { name, sequence, eventType: "press" } as KeyEvent;
}
const project: Project = {
    id: "p1",
    name: "Project",
    path: "/tmp/p1",
    sessions: [],
    attributes: [],
    createdAt: "now",
};
const schedule: Schedule = {
    id: "s1",
    projectId: "p1",
    name: "Nightly",
    prompt: "echo ok",
    expression: "5m",
    expressionType: "rate",
    timeout: 30,
    enabled: false,
    lastRunAt: null,
    lastError: null,
    nextRunAt: null,
    runningSessionId: null,
    createdAt: "now",
    updatedAt: "now",
};

describe("Schedules", () => {
    const cleanup: Array<() => void> = [];
    afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

    async function setup(enabled: boolean) {
        const renderer = await createTestRenderer({ width: 100, height: 12 });
        const calls: string[] = [];
        const view = new Schedules({
            renderer: renderer.renderer,
            schedules: [schedule],
            projects: [project],
            schedulerEnabled: enabled,
            onCreate: async () => {
                calls.push("create");
            },
            onEdit: async () => {
                calls.push("edit");
            },
            onDelete: async () => {
                calls.push("delete");
            },
            onToggle: async () => {
                calls.push("toggle");
            },
            onTrigger: async () => {
                calls.push("trigger");
            },
            confirm: async (message) => {
                calls.push(`confirm:${message}`);
                return true;
            },
            onClose: () => calls.push("close"),
        });
        renderer.renderer.root.add(view.renderable);
        cleanup.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );
        return { calls, renderer, view };
    }

    it("shows the exact read-only banner and suppresses every mutation", async () => {
        const test = await setup(false);
        await test.renderer.renderOnce();
        expect(test.view.renderable).toBeDefined();
        expect(test.renderer.captureCharFrame()).toContain(READ_ONLY_BANNER);
        for (const event of [key("n"), key("e"), key("d"), key(" ", "space"), key("t")]) {
            test.view.handleKey(event);
        }
        await Promise.resolve();
        expect(test.calls).toEqual([]);
    });

    it("runs main-backend mutation commands through confirmations", async () => {
        const test = await setup(true);
        test.view.handleKey(key("n"));
        await Promise.resolve();
        test.view.handleKey(key(" ", "space"));
        await Promise.resolve();
        test.view.handleKey(key("e"));
        await Promise.resolve();
        test.view.handleKey(key("d"));
        await Promise.resolve();
        await Promise.resolve();
        test.view.handleKey(key("t"));
        await Promise.resolve();
        await Promise.resolve();
        expect(test.calls).toEqual([
            "create",
            "toggle",
            "edit",
            "confirm:Delete Nightly?",
            "delete",
            "confirm:Trigger Nightly now?",
            "trigger",
        ]);
    });

    it("keeps selection by schedule ID across updates", async () => {
        const test = await setup(true);
        test.view.update([{ ...schedule, name: "Updated" }]);
        expect(test.view.selectedId).toBe("s1");
    });
});
