import { describe, expect, it } from "bun:test";
import { acceptsDrop, parseDroppedTask } from "./dropped-task";

function drop(values: Record<string, string>) {
    return {
        types: Object.keys(values),
        getData: (type: string) => values[type] ?? "",
    };
}

describe("acceptsDrop", () => {
    it("takes anything carrying text", () => {
        expect(acceptsDrop(["text/plain"])).toBe(true);
        expect(acceptsDrop(["text/uri-list"])).toBe(true);
        expect(acceptsDrop(["text/html"])).toBe(true);
    });

    it("declines a drag with nothing readable in it", () => {
        expect(acceptsDrop(["Files"])).toBe(false);
        expect(acceptsDrop([])).toBe(false);
    });
});

describe("a drag from TaskTray", () => {
    it("takes the exact title and description out of the query string", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list":
                    "tasktray://task/WEB-12?title=Checkout%20redesign&description=Rip%20out%20the%20modal.",
                "text/plain": "Checkout redesign\n\nRip out the modal.",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "Rip out the modal." });
    });

    // The case the hand-rolled percent encoder in TaskTray's `TaskURL` exists
    // for: `urlQueryAllowed` permits all of these, so encoding against it tears
    // the query into extra parameters.
    it("survives a description full of query punctuation", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list":
                    "tasktray://task/WEB-12?title=R%26D%20%2B%20design" +
                    "&description=a%2Bb%3Dc%2C%20100%25%20done%3F%20no.",
            }),
        );

        expect(parsed).toEqual({
            title: "R&D + design",
            description: "a+b=c, 100% done? no.",
        });
    });

    it("reads a task with no description", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list": "tasktray://task/WEB-12?title=Checkout%20redesign",
                "text/plain": "Checkout redesign",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "" });
    });

    // The other shape the sender may use: the URL is provenance only and the
    // content is in the body. Accepted so TaskTray can switch without a change
    // here.
    it("splits the body at its first blank line when the marker carries no fields", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list": "tasktray://task/WEB-12",
                "text/plain": "Checkout redesign\n\nFirst.\n\nSecond.",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "First.\n\nSecond." });
    });

    it("strips a marker that arrived as a trailing line of the body", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/plain": "Checkout redesign\n\nRip out the modal.\n\ntasktray://task/WEB-12",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "Rip out the modal." });
    });

    it("folds CRLF so the blank-line split still finds the separator", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list": "tasktray://task/WEB-12",
                "text/plain": "Checkout redesign\r\n\r\nRip out the modal.",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "Rip out the modal." });
    });

    it("reads the body when the query is present but empty", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/uri-list": "tasktray://task/WEB-12?title=&description=",
                "text/plain": "Checkout redesign\n\nRip out the modal.",
            }),
        );

        expect(parsed).toEqual({ title: "Checkout redesign", description: "Rip out the modal." });
    });
});

describe("a drag from a browser", () => {
    it("takes the title from the anchor and keeps the link", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/html":
                    '<meta charset="utf-8"><a href="https://linear.app/x/ENG-9">ENG-9 Fix the thing</a>',
                "text/plain": "https://linear.app/x/ENG-9",
                "text/uri-list": "https://linear.app/x/ENG-9",
            }),
        );

        expect(parsed).toEqual({
            title: "ENG-9 Fix the thing",
            description: "https://linear.app/x/ENG-9",
        });
    });

    it("keeps a text selection alongside the link it came with", () => {
        const parsed = parseDroppedTask(
            drop({
                "text/html": '<a href="https://example.com/x">The heading</a>',
                "text/plain": "Some selected prose.",
            }),
        );

        expect(parsed).toEqual({
            title: "The heading",
            description: "Some selected prose.\n\nhttps://example.com/x",
        });
    });
});

describe("a drag from anywhere else", () => {
    it("makes the whole text the description and leaves the title to the user", () => {
        const parsed = parseDroppedTask(
            drop({ "text/plain": "  Rewrite the onboarding email.  " }),
        );

        expect(parsed).toEqual({ description: "Rewrite the onboarding email." });
    });

    it("keeps a multi-paragraph note whole rather than guessing at a title", () => {
        const text = "First paragraph.\n\nSecond paragraph.";

        expect(parseDroppedTask(drop({ "text/plain": text }))).toEqual({ description: text });
    });

    it("falls back to a bare URI list when there is no text flavour", () => {
        expect(parseDroppedTask(drop({ "text/uri-list": "https://example.com/x" }))).toEqual({
            description: "https://example.com/x",
        });
    });

    it("declines a drag with nothing in it", () => {
        expect(parseDroppedTask(drop({}))).toBeNull();
        expect(parseDroppedTask(drop({ "text/plain": "   " }))).toBeNull();
    });
});
