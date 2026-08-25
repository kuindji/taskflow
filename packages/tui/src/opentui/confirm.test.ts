import { afterEach, describe, expect, it } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { Confirm } from "./confirm";

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

describe("Confirm", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

    async function setup() {
        const test = await createTestRenderer({ width: 80, height: 24 });
        let confirmed = 0;
        let cancelled = 0;
        const confirm = new Confirm({
            renderer: test.renderer,
            title: "Close session",
            message: "Closing terminates the process and removes its saved transcript.",
            onConfirm: () => confirmed++,
            onCancel: () => cancelled++,
        });
        test.renderer.root.add(confirm.renderable);
        cleanups.push(
            () => confirm.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, confirm, confirmed: () => confirmed, cancelled: () => cancelled };
    }

    it("renders the destructive consequence and accepts y or Enter once", async () => {
        const { test, confirm, confirmed } = await setup();
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("terminates the process");
        expect(test.captureCharFrame()).toContain("its saved transcript");
        expect(confirm.keyHints).toContain("Enter/y Confirm");
        confirm.handleKey(key("y", "y"));
        expect(confirm.keyHints).toBe(" Working...");
        confirm.handleKey(key("return", "\r"));
        expect(confirmed()).toBe(1);
    });

    it("cancels with n or Escape and shows a retryable error", async () => {
        const { test, confirm, cancelled } = await setup();
        confirm.handleKey(key("n", "n"));
        confirm.handleKey(key("escape", "\x1b"));
        expect(cancelled()).toBe(2);
        confirm.handleKey(key("y", "y"));
        confirm.setError("Close failed");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Close failed");
    });
});
