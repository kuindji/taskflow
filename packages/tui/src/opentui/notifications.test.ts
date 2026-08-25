import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { Notification } from "@taskflow/shared";
import { Notifications } from "./notifications";

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

function notification(id: string, createdAt: string, read = false): Notification {
    return { id, projectId: "p1", sessionId: "s1", message: id, read, createdAt };
}

describe("Notifications", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("keeps selection by notification ID across updates", async () => {
        const test = await createTestRenderer({ width: 80, height: 20 });
        const items = [
            notification("old", "2026-08-25T10:00:00.000Z"),
            notification("new", "2026-08-25T11:00:00.000Z"),
        ];
        const view = new Notifications({
            renderer: test.renderer,
            notifications: items,
            onOpen: () => undefined,
            onMarkRead: () => undefined,
            onMarkAllRead: () => undefined,
            onClearRead: () => undefined,
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("down"));
        expect(view.selectedId).toBe("old");
        view.update([
            notification("latest", "2026-08-25T12:00:00.000Z"),
            ...items,
        ]);
        expect(view.selectedId).toBe("old");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("●");
    });

    test("routes read, bulk, clear, open, and close commands once while pending", async () => {
        const test = await createTestRenderer({ width: 80, height: 20 });
        const calls: string[] = [];
        const item = notification("one", "2026-08-25T10:00:00.000Z");
        const view = new Notifications({
            renderer: test.renderer,
            notifications: [item],
            onOpen: () => calls.push("open"),
            onMarkRead: () => calls.push("read"),
            onMarkAllRead: () => calls.push("all"),
            onClearRead: () => calls.push("clear"),
            onClose: () => calls.push("close"),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("r"));
        view.handleKey(key("a"));
        view.handleKey(key("x"));
        view.handleKey(key("return", "\r"));
        view.handleKey(key("escape", "\x1b"));
        expect(calls).toEqual(["read", "all", "clear", "open", "close"]);
        view.setPending(true);
        view.handleKey(key("a"));
        expect(calls).toHaveLength(5);
    });
});
