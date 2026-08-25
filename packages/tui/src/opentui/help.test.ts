import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { COMMAND_METADATA } from "./keys";
import { Help } from "./help";

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

describe("Help", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("renders every command from the shared metadata grouped by product", async () => {
        const testRenderer = await createTestRenderer({ width: 80, height: 40 });
        const view = new Help({
            renderer: testRenderer.renderer,
            onClose: () => undefined,
        });
        testRenderer.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => testRenderer.renderer.destroy());
        await testRenderer.renderOnce();
        const frame = testRenderer.captureCharFrame();
        for (const group of ["Sessions", "Tasks", "Flows", "Schedules", "Git", "Settings", "Notifications"]) {
            expect(frame).toContain(group);
        }
        for (const command of COMMAND_METADATA) expect(frame).toContain(command.description);
    });

    test("scrolls from keyboard input and closes once", async () => {
        const testRenderer = await createTestRenderer({ width: 60, height: 10 });
        let closes = 0;
        const view = new Help({
            renderer: testRenderer.renderer,
            onClose: () => closes++,
        });
        testRenderer.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => testRenderer.renderer.destroy());
        await testRenderer.renderOnce();
        const before = testRenderer.captureCharFrame();
        view.handleKey(key("pagedown"));
        await testRenderer.renderOnce();
        expect(testRenderer.captureCharFrame()).not.toBe(before);
        view.handleKey(key("escape", "\x1b"));
        expect(closes).toBe(1);
    });
});
