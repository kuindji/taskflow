import { describe, expect, it } from "bun:test";
import { isMarkdownPath, planFileOpen } from "./open-file-plan";

const MONACO = { internalEditor: "monaco", editorAvailable: false };
const NVIM = { internalEditor: "nvim", editorAvailable: true };

describe("isMarkdownPath", () => {
    it("accepts .md and .markdown in any case", () => {
        expect(isMarkdownPath("/a/b/README.md")).toBe(true);
        expect(isMarkdownPath("/a/b/README.MD")).toBe(true);
        expect(isMarkdownPath("/a/b/notes.markdown")).toBe(true);
    });

    it("rejects other extensions and lookalikes", () => {
        expect(isMarkdownPath("/a/b/index.ts")).toBe(false);
        expect(isMarkdownPath("/a/b/md")).toBe(false);
        expect(isMarkdownPath("/a/b/file.mdx")).toBe(false);
    });
});

describe("planFileOpen", () => {
    it("sends a markdown file with no line to preview", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", ...MONACO })).toEqual({
            kind: "markdown",
            mode: "preview",
        });
    });

    it("sends a markdown file with a line to edit mode at that line", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", line: 214, ...MONACO })).toEqual({
            kind: "markdown",
            mode: "edit",
            line: 214,
        });
    });

    it("still uses in-tab edit mode for a markdown line when a CLI editor is configured", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", line: 12, ...NVIM })).toEqual({
            kind: "markdown",
            mode: "edit",
            line: 12,
        });
    });

    it("still previews a markdown file with no line when a CLI editor is configured", () => {
        expect(planFileOpen({ filePath: "/w/doc.md", ...NVIM })).toEqual({
            kind: "markdown",
            mode: "preview",
        });
    });

    it("sends non-markdown files to monaco when monaco is selected", () => {
        expect(planFileOpen({ filePath: "/w/a.ts", line: 3, ...MONACO })).toEqual({
            kind: "monaco",
            line: 3,
        });
    });

    it("falls back to monaco when the configured CLI editor is unavailable", () => {
        expect(
            planFileOpen({
                filePath: "/w/a.ts",
                internalEditor: "nvim",
                editorAvailable: false,
            }),
        ).toEqual({ kind: "monaco" });
    });

    it("sends non-markdown files to an available CLI editor", () => {
        expect(planFileOpen({ filePath: "/w/a.ts", ...NVIM })).toEqual({ kind: "cli-editor" });
    });
});
