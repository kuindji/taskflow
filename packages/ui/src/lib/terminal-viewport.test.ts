import { describe, expect, it } from "bun:test";
import {
    captureTerminalViewport,
    getRestoreViewportLine,
    isTerminalViewportAtBottom,
} from "./terminal-viewport";

describe("terminal viewport helpers", () => {
    it("treats a viewport at the buffer bottom as following output", () => {
        expect(isTerminalViewportAtBottom({ baseY: 240, viewportY: 240 })).toBe(true);
        expect(isTerminalViewportAtBottom({ baseY: 240, viewportY: 239 })).toBe(true);
    });

    it("captures absolute viewport position when scrolled up", () => {
        expect(captureTerminalViewport({ baseY: 240, viewportY: 120 })).toEqual({
            isAtBottom: false,
            viewportY: 120,
        });
    });

    it("restores a scrolled-up viewport to the same absolute line after buffer growth", () => {
        const snapshot = captureTerminalViewport({ baseY: 240, viewportY: 120 });
        expect(getRestoreViewportLine({ baseY: 320, viewportY: 200 }, snapshot)).toBe(120);
    });

    it("keeps bottom-following viewports pinned to the new bottom after buffer growth", () => {
        const snapshot = captureTerminalViewport({ baseY: 240, viewportY: 240 });
        expect(getRestoreViewportLine({ baseY: 320, viewportY: 280 }, snapshot)).toBe(320);
    });

    it("clamps restored viewport lines when history is shorter after resize", () => {
        const snapshot = captureTerminalViewport({ baseY: 240, viewportY: 120 });
        expect(getRestoreViewportLine({ baseY: 80, viewportY: 40 }, snapshot)).toBe(80);
    });
});
