import { beforeEach, describe, expect, it } from "bun:test";
import type { SessionMovePayload, Task } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { createSessionMoveDrag, type TabDragEvent } from "./useSessionMoveDrag";

const taskA: Task & { backendId: string } = {
    id: "a",
    projectId: "p1",
    title: "A",
    description: "",
    notes: "",
    worktree: { enabled: false, path: null, branch: null, pr: null },
    sessions: [],
    attributes: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    status: "active",
    archivedAt: null,
    pinned: false,
    backendId: "local",
};

const zone = document.createElement("div");
zone.dataset.sessionDropZone = "";
const card = document.createElement("div");
card.dataset.sessionDrop = "task:b";
card.dataset.sessionDropBackend = "local";
zone.appendChild(card);
const workspace = document.createElement("div");

let sent: Array<{ backendId: string; payload: SessionMovePayload }>;
let reported: string[];
let failWith: Error | null;
let pointerEvents: EventTarget;

function setup() {
    return createSessionMoveDrag({
        send: (backendId, payload) => {
            sent.push({ backendId, payload });
            return failWith ? Promise.reject(failWith) : Promise.resolve({ success: true });
        },
        report: (message) => reported.push(message),
        // x < 100 is the workspace, 100-199 a sidebar gap, 200+ the card;
        // an overlay always sits on top, as dnd-kit's DragOverlay does.
        elementsAt: (x) => [
            document.createElement("div"),
            ...(x >= 200 ? [card, zone] : x >= 100 ? [zone] : [workspace]),
        ],
        pointerEvents,
    });
}

function dragEvent(id: string): TabDragEvent {
    return { active: { id }, activatorEvent: new MouseEvent("pointerdown", { clientX: 0 }) };
}

function movePointer(x: number) {
    pointerEvents.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: 0 }));
}

beforeEach(() => {
    sent = [];
    reported = [];
    failWith = null;
    pointerEvents = new EventTarget();
    useTaskStore.setState({ tasks: [taskA] });
    useSessionStore.setState({
        tabsByWorkspace: {
            "task:a": [
                { id: "s1", type: "claude", label: "Claude", sessionId: "s1", movable: true },
                { id: "sh", type: "shell", label: "zsh", sessionId: "sh" },
            ],
        },
    });
    useUIStore.getState().setSessionDropTarget(null);
});

describe("session move drag", () => {
    it("highlights a valid card under the overlay and moves the session on drop", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        expect(useUIStore.getState().sessionDropTarget?.key).toBe("task:b");

        expect(drag.onDragEnd(dragEvent("s1"))).toBe(true);
        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(sent).toEqual([{ backendId: "local", payload: { sessionId: "s1", taskId: "b" } }]);
    });

    it("leaves drops in the workspace to the existing handlers", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(10);
        drag.onDragMove(dragEvent("s1"));

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(dragEvent("s1"))).toBe(false);
        expect(sent).toEqual([]);
    });

    it("swallows a drop on a sidebar gap or an invalid card", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("sh"));
        movePointer(250);
        drag.onDragMove(dragEvent("sh"));
        expect(useUIStore.getState().sessionDropTarget).toBeNull();
        expect(drag.onDragEnd(dragEvent("sh"))).toBe(true);

        drag.onDragStart(dragEvent("s1"));
        movePointer(150);
        expect(drag.onDragEnd(dragEvent("s1"))).toBe(true);
        expect(sent).toEqual([]);
    });

    it("uses where the pointer is at drop time", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        movePointer(10);

        expect(drag.onDragEnd(dragEvent("s1"))).toBe(false);
        expect(sent).toEqual([]);
    });

    it("stops tracking the pointer and clears the target on cancel", () => {
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragMove(dragEvent("s1"));
        drag.onDragCancel();

        expect(useUIStore.getState().sessionDropTarget).toBeNull();
    });

    it("reports the backend's refusal", async () => {
        failWith = new Error("Flow sessions cannot be moved");
        const drag = setup();
        drag.onDragStart(dragEvent("s1"));
        movePointer(250);
        drag.onDragEnd(dragEvent("s1"));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(reported).toEqual(["Flow sessions cannot be moved"]);
    });
});
