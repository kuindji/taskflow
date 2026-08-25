import { afterEach, describe, expect, it } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { ActionDefinition, FlowDefinition, FlowRun as FlowRunRecord } from "@taskflow/shared";
import { FlowRun } from "./flow-run";

function key(sequence: string): KeyEvent {
    return { name: sequence, sequence, eventType: "press" } as KeyEvent;
}

const action: ActionDefinition = {
    id: "action",
    name: "Build",
    prompt: "bun run build",
    sessionType: "shell",
    createdAt: "now",
    updatedAt: "now",
};
const flow: FlowDefinition = {
    id: "flow",
    name: "Release",
    description: "",
    actions: [{ id: "entry", actionId: "action" }],
    createdAt: "now",
    updatedAt: "now",
};
function run(
    status: FlowRunRecord["status"],
    actionStatus: "running" | "failed" = "running",
): FlowRunRecord {
    return {
        projectId: "p1",
        flowId: "flow",
        status,
        currentActionIndex: 0,
        actions: [{ actionEntryId: "entry", status: actionStatus, sessionId: "session" }],
        artifacts: [],
        startedAt: "now",
    };
}

describe("FlowRun", () => {
    const cleanup: Array<() => void> = [];
    afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

    async function setup(initial = run("running"), sessionState: "live" | "interrupted" = "live") {
        const renderer = await createTestRenderer({ width: 80, height: 12 });
        const calls: string[] = [];
        const view = new FlowRun({
            renderer: renderer.renderer,
            run: initial,
            flow,
            actions: [action],
            sessionState: () => sessionState,
            pause: async () => {
                calls.push("pause");
            },
            resume: async () => {
                calls.push("resume");
            },
            stop: async () => {
                calls.push("stop");
            },
            skip: async () => {
                calls.push("skip");
            },
            jump: async (index) => {
                calls.push(`jump:${String(index)}`);
            },
            confirm: async (message) => {
                calls.push(`confirm:${message}`);
                return true;
            },
            onFocusSession: (id) => calls.push(`focus:${id}`),
            onLibrary: () => calls.push("library"),
            onClose: () => calls.push("close"),
            onDismiss: () => calls.push("dismiss"),
        });
        renderer.renderer.root.add(view.renderable);
        cleanup.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );
        return { calls, view };
    }

    it("focuses a session and sends one pending control", async () => {
        const test = await setup();
        expect(test.view.keyHints).toContain("p Pause");
        expect(test.view.keyHints).toContain("s Skip");
        test.view.handleKey(key("enter"));
        test.view.handleKey(key("p"));
        test.view.handleKey(key("p"));
        await Promise.resolve();
        expect(test.calls).toEqual(["focus:session", "pause"]);
    });

    it("blocks ordinary resume for an interrupted current session", async () => {
        const test = await setup(run("paused"), "interrupted");
        test.view.handleKey(key("p"));
        await Promise.resolve();
        expect(test.calls).toEqual([]);
    });

    it("confirms restart only from a completed or failed action", async () => {
        const test = await setup(run("failed", "failed"));
        expect(test.view.keyHints).toContain("R Restart");
        expect(test.view.keyHints).toContain("d Dismiss");
        expect(test.view.keyHints).not.toContain("p Pause");
        test.view.handleKey(key("R"));
        await Promise.resolve();
        await Promise.resolve();
        expect(test.calls).toEqual(["confirm:Restart from this action?", "jump:0"]);
    });
});
