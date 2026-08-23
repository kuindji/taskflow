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

    // One row is the smallest size at which `rows - 1` is still correct on its
    // own, so the test above passes with or without the clamp and pins nothing.
    // Zero rows is the only input that reaches it. `index.ts` cannot produce
    // one today — `process.stdout.rows || 24` turns a zero into 24 — so this
    // guards the clamp for the resize path that will call `computeLayout`
    // directly rather than for a size the entry point can pass now.
    test("a zero-row terminal leaves the pane no height either", () => {
        expect(computeLayout(80, 0, false).paneHeight).toBe(0);
    });

    test("the pane fills the columns the sidebar does not", () => {
        const layout = computeLayout(100, 30, false);
        expect(layout.paneX).toBe(layout.sidebarWidth);
        expect(layout.paneX + layout.paneWidth).toBe(layout.cols);
    });
});
