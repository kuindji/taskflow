import { afterEach, describe, expect, it } from "bun:test";
import type { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { ActionDefinition, FlowDefinition } from "@taskflow/shared";
import { FlowLibrary } from "./flow-library";

function key(name: string, sequence = name): KeyEvent {
    return { name, sequence, eventType: "press" } as KeyEvent;
}

const flow = (id: string): FlowDefinition => ({
    id,
    name: id,
    description: "",
    actions: [{ id: "entry", actionId: "a" }],
    createdAt: "now",
    updatedAt: "now",
});
const action = (id: string, standalone = true): ActionDefinition => ({
    id,
    name: id,
    prompt: "echo ok",
    sessionType: "shell",
    standalone,
    createdAt: "now",
    updatedAt: "now",
});

describe("FlowLibrary", () => {
    const cleanup: Array<() => void> = [];
    afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

    async function setup() {
        const renderer = await createTestRenderer({ width: 80, height: 15 });
        const calls: string[] = [];
        const view = new FlowLibrary({
            renderer: renderer.renderer,
            flows: [flow("f1"), flow("f2")],
            actions: [action("a1", false), action("a2")],
            onStartFlow: (item) => calls.push(`flow:${item.id}`),
            onRunAction: (item) => calls.push(`action:${item.id}`),
            onCreate: (tab) => calls.push(`new:${tab}`),
            onEdit: (item) => calls.push(`edit:${item.id}`),
            onDelete: (item) => calls.push(`delete:${item.id}`),
            onViewRun: () => calls.push("run"),
            onClose: () => calls.push("close"),
        });
        renderer.renderer.root.add(view.renderable);
        cleanup.push(
            () => view.destroy(),
            () => renderer.renderer.destroy(),
        );
        return { calls, view };
    }

    it("switches tabs, moves selection, and blocks non-standalone actions", async () => {
        const test = await setup();
        test.view.handleKey(key("tab"));
        expect(test.view.activeTab).toBe("actions");
        test.view.handleKey(key("enter"));
        expect(test.calls).toEqual([]);
        test.view.handleKey(key("down", "j"));
        test.view.handleKey(key("enter"));
        expect(test.calls).toEqual(["action:a2"]);
    });

    it("preserves selection by ID across list updates", async () => {
        const test = await setup();
        test.view.handleKey(key("down", "j"));
        expect(test.view.selectedId).toBe("f2");
        test.view.update([flow("new"), flow("f2")], [action("a2")]);
        expect(test.view.selectedId).toBe("f2");
        test.view.handleKey(key("enter"));
        expect(test.calls).toEqual(["flow:f2"]);
    });
});
