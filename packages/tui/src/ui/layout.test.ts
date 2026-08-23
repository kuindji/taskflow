import { describe, test, expect } from "bun:test";
import { computeLayout } from "./layout";

describe("computeLayout", () => {
    test("the sidebar is a third of the width, capped at 30", () => {
        expect(computeLayout(120, 40, false).sidebarWidth).toBe(30);
        expect(computeLayout(60, 40, false).sidebarWidth).toBe(20);
    });

    test("zoom removes the sidebar and gives the pane every column", () => {
        const layout = computeLayout(120, 40, true);
        expect(layout.sidebarWidth).toBe(0);
        expect(layout.paneX).toBe(0);
        expect(layout.paneWidth).toBe(120);
    });

    test("the tab strip owns row 0 and the pane the rest", () => {
        const layout = computeLayout(120, 40, false);
        expect(layout.tabRow).toBe(0);
        expect(layout.paneY).toBe(1);
        expect(layout.paneHeight).toBe(39);
    });

    test("a one-row terminal leaves the pane no height rather than a negative one", () => {
        expect(computeLayout(80, 1, false).paneHeight).toBe(0);
    });

    test("the pane fills the columns the sidebar does not", () => {
        const layout = computeLayout(100, 30, false);
        expect(layout.paneX).toBe(layout.sidebarWidth);
        expect(layout.paneX + layout.paneWidth).toBe(layout.cols);
    });
});
