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
        cleanups.push(
            () => view.destroy(),
            () => testRenderer.renderer.destroy(),
        );
        await testRenderer.renderOnce();
        const frame = testRenderer.captureCharFrame();
        for (const group of [
            "Sessions",
            "Tasks",
            "Flows",
            "Schedules",
            "Git",
            "Settings",
            "Notifications",
        ]) {
            expect(frame).toContain(group);
        }
        for (const command of COMMAND_METADATA) expect(frame).toContain(command.description);
    });

    test("marks a this-machine-only command in its description", async () => {
        const testRenderer = await createTestRenderer({ width: 80, height: 20 });
        const view = new Help({
            renderer: testRenderer.renderer,
            commands: [
                {
                    kind: "git",
                    group: "Git",
                    keys: "g",
                    label: "Git",
                    description: "Synthetic local command",
                    localOnly: true,
                    route: () => null,
                },
                {
                    kind: "zoom",
                    group: "General",
                    keys: "z",
                    label: "Zoom",
                    description: "Synthetic shared command",
                    route: () => null,
                },
            ],
            onClose: () => undefined,
        });
        testRenderer.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => testRenderer.renderer.destroy(),
        );
        await testRenderer.renderOnce();
        const frame = testRenderer.captureCharFrame();
        expect(frame).toContain("Synthetic local command (this machine only)");
        expect(frame).toContain("Synthetic shared command");
        expect(frame).not.toContain("Synthetic shared command (this machine only)");
    });

    test("scrolls from keyboard input and closes once", async () => {
        const testRenderer = await createTestRenderer({ width: 60, height: 10 });
        let closes = 0;
        const view = new Help({
            renderer: testRenderer.renderer,
            onClose: () => closes++,
        });
        testRenderer.renderer.root.add(view.renderable);
        cleanups.push(
            () => view.destroy(),
            () => testRenderer.renderer.destroy(),
        );
        await testRenderer.renderOnce();
        const before = testRenderer.captureCharFrame();
        view.handleKey(key("pagedown"));
        await testRenderer.renderOnce();
        expect(testRenderer.captureCharFrame()).not.toBe(before);
        view.handleKey(key("escape", "\x1b"));
        expect(closes).toBe(1);
    });
});
