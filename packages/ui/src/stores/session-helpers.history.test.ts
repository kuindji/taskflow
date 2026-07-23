import { describe, expect, it } from "bun:test";
import { pushHistory, stepHistory } from "./session-helpers";
import type { Tab } from "./session-helpers";

function markdownTab(overrides: Partial<Tab> = {}): Tab {
    return {
        id: "t",
        type: "markdown",
        label: "a.md",
        filePath: "/w/a.md",
        mode: "preview",
        history: ["/w/a.md"],
        historyIndex: 0,
        ...overrides,
    };
}

describe("pushHistory", () => {
    it("appends and moves to the new entry", () => {
        const next = pushHistory(markdownTab(), "/w/b.md");
        expect(next.history).toEqual(["/w/a.md", "/w/b.md"]);
        expect(next.historyIndex).toBe(1);
        expect(next.filePath).toBe("/w/b.md");
        expect(next.label).toBe("b.md");
    });

    it("resets the stored scroll offset for the new page", () => {
        const next = pushHistory(markdownTab({ previewScrollTop: 900 }), "/w/b.md");
        expect(next.previewScrollTop).toBe(0);
    });

    it("truncates the forward entries", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md", "/w/c.md"], historyIndex: 0 });
        const next = pushHistory(tab, "/w/d.md");
        expect(next.history).toEqual(["/w/a.md", "/w/d.md"]);
        expect(next.historyIndex).toBe(1);
    });

    it("is a no-op when navigating to the page already shown", () => {
        const tab = markdownTab();
        expect(pushHistory(tab, "/w/a.md")).toBe(tab);
    });

    it("seeds history for a tab that has none", () => {
        const tab = markdownTab({ history: undefined, historyIndex: undefined });
        const next = pushHistory(tab, "/w/b.md");
        expect(next.history).toEqual(["/w/a.md", "/w/b.md"]);
        expect(next.historyIndex).toBe(1);
    });
});

describe("stepHistory", () => {
    it("goes back", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 1 });
        const next = stepHistory(tab, -1);
        expect(next.historyIndex).toBe(0);
        expect(next.filePath).toBe("/w/a.md");
        expect(next.label).toBe("a.md");
    });

    it("goes forward", () => {
        const tab = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 0 });
        expect(stepHistory(tab, 1).filePath).toBe("/w/b.md");
    });

    it("returns the same tab at either end", () => {
        const atStart = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 0 });
        expect(stepHistory(atStart, -1)).toBe(atStart);
        const atEnd = markdownTab({ history: ["/w/a.md", "/w/b.md"], historyIndex: 1 });
        expect(stepHistory(atEnd, 1)).toBe(atEnd);
    });
});
