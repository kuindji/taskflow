import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { ScreenBuffer, ATTR_INVERSE } from "../render/cells";
import { SessionTerminal } from "../term/session-terminal";
import { drawTabs, drawSessionPane } from "./session-pane";
import type { NetLike } from "../net/client";

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                } as unknown as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function rowText(buf: ScreenBuffer, y: number, width: number): string {
    let out = "";
    for (let x = 0; x < width; x++) out += buf.get(x, y).ch;
    return out.trimEnd();
}

describe("drawTabs", () => {
    test("renders every tab label", () => {
        const buf = new ScreenBuffer(30, 2);
        drawTabs(buf, 0, 0, 30, [
            { label: "claude", active: true },
            { label: "shell", active: false },
        ]);
        const text = rowText(buf, 0, 30);
        expect(text).toContain("claude");
        expect(text).toContain("shell");
    });

    test("marks the active tab with the inverse attribute", () => {
        const buf = new ScreenBuffer(30, 2);
        drawTabs(buf, 0, 0, 30, [{ label: "claude", active: true }]);
        expect(buf.get(1, 0).attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
    });

    test("leaves the columns after the last tab blank and unstyled", () => {
        const buf = new ScreenBuffer(20, 2);
        drawTabs(buf, 0, 0, 20, [{ label: "one", active: true }]);
        // " one " is five columns; everything past it belongs to no tab.
        for (let x = 5; x < 20; x++) {
            expect(buf.get(x, 0).ch).toBe(" ");
            expect(buf.get(x, 0).attrs).toBe(0);
        }
    });

    test("draws at the given offset and touches nothing outside the strip", () => {
        const buf = new ScreenBuffer(20, 2);
        buf.set(0, 0, { ...buf.get(0, 0), ch: "L" });
        buf.set(14, 0, { ...buf.get(14, 0), ch: "R" });
        drawTabs(buf, 4, 0, 10, [{ label: "one", active: false }]);
        expect(buf.get(0, 0).ch).toBe("L");
        expect(buf.get(4, 0).ch).toBe(" ");
        expect(buf.get(5, 0).ch).toBe("o");
        expect(buf.get(14, 0).ch).toBe("R");
    });

    test("clears a stale strip when there are no tabs at all", () => {
        const buf = new ScreenBuffer(20, 2);
        drawTabs(buf, 0, 0, 20, [{ label: "gone", active: true }]);
        drawTabs(buf, 0, 0, 20, []);
        expect(rowText(buf, 0, 20)).toBe("");
        expect(buf.get(1, 0).attrs).toBe(0);
    });

    test("never writes past the strip when the tabs overflow it", () => {
        const buf = new ScreenBuffer(20, 2);
        buf.set(10, 0, { ...buf.get(10, 0), ch: "K" });
        drawTabs(buf, 0, 0, 10, [
            { label: "alpha", active: true },
            { label: "bravo", active: false },
            { label: "charlie", active: false },
        ]);
        expect(buf.get(10, 0).ch).toBe("K");
        expect(rowText(buf, 0, 10)).toBe(" alpha  b");
    });

    test("keeps a wide glyph paired rather than splitting it at the strip edge", () => {
        const buf = new ScreenBuffer(20, 2);
        // " 日本 " is six columns; at width 5 the second glyph cannot be drawn.
        drawTabs(buf, 0, 0, 5, [{ label: "日本", active: true }]);
        expect(buf.get(1, 0).ch).toBe("日");
        expect(buf.get(1, 0).width).toBe(2);
        expect(buf.get(2, 0).width).toBe(0);
        expect(buf.get(3, 0).ch).toBe(" ");
        expect(buf.get(4, 0).ch).toBe(" ");
        expect(buf.get(4, 0).attrs).toBe(0);
    });

    test("drops a control character in a label instead of emitting it", () => {
        const buf = new ScreenBuffer(20, 2);
        drawTabs(buf, 0, 0, 20, [{ label: "a\u0007b", active: false }]);
        for (let x = 0; x < 20; x++) expect(buf.get(x, 0).ch).not.toBe("\u0007");
        expect(rowText(buf, 0, 20)).toBe(" ab");
    });
});

describe("drawSessionPane", () => {
    test("blits session content into the rect and returns the cursor", async () => {
        const session = new SessionTerminal({
            net: stubNet(),
            sessionId: "s1",
            owner: {},
            cols: 10,
            rows: 3,
        });
        await new Promise<void>((resolve) => session.terminal.write("hey", resolve));

        const buf = new ScreenBuffer(20, 6);
        const cursor = drawSessionPane(buf, session, { x: 5, y: 2, width: 10, height: 3 });
        expect(buf.get(5, 2).ch).toBe("h");
        expect(cursor).toEqual({ x: 8, y: 2 });
        session.dispose();
    });

    test("clears the rect and returns null when there is no session", () => {
        const buf = new ScreenBuffer(20, 6);
        buf.set(5, 2, { ...buf.get(5, 2), ch: "X" });
        const cursor = drawSessionPane(buf, null, { x: 5, y: 2, width: 10, height: 3 });
        expect(buf.get(5, 2).ch).toBe(" ");
        expect(cursor).toBeNull();
    });

    test("clearing an empty pane leaves the cells around it alone", () => {
        const buf = new ScreenBuffer(20, 6);
        buf.set(4, 2, { ...buf.get(4, 2), ch: "L" });
        buf.set(15, 2, { ...buf.get(15, 2), ch: "R" });
        buf.set(5, 1, { ...buf.get(5, 1), ch: "U" });
        buf.set(5, 5, { ...buf.get(5, 5), ch: "D" });
        drawSessionPane(buf, null, { x: 5, y: 2, width: 10, height: 3 });
        expect(buf.get(4, 2).ch).toBe("L");
        expect(buf.get(15, 2).ch).toBe("R");
        expect(buf.get(5, 1).ch).toBe("U");
        expect(buf.get(5, 5).ch).toBe("D");
    });
});
