import { describe, expect, it } from "bun:test";
import { detectEditors } from "../../src/services/editor-detector";
import type { EditorInfo } from "@taskflow/shared";

const expectedCatalog: EditorInfo[] = [
    { id: "nvim", name: "Neovim", command: "nvim", type: "internal", lineFlag: "+{line}" },
    { id: "vim", name: "Vim", command: "vim", type: "internal", lineFlag: "+{line}" },
    { id: "nano", name: "Nano", command: "nano", type: "internal", lineFlag: "+{line}" },
    { id: "vi", name: "Vi", command: "vi", type: "internal", lineFlag: "+{line}" },
    { id: "helix", name: "Helix", command: "hx", type: "internal", lineFlag: "{file}:{line}" },
    { id: "micro", name: "Micro", command: "micro", type: "internal", lineFlag: "+{line}" },
    {
        id: "emacs",
        name: "Emacs",
        command: "emacs",
        type: "internal",
        lineFlag: "+{line}",
        extraArgs: ["-nw"],
    },
    { id: "vscode", name: "VS Code", command: "code", type: "external" },
    { id: "cursor", name: "Cursor", command: "cursor", type: "external" },
    { id: "zed", name: "Zed", command: "zed", type: "external" },
    { id: "sublime", name: "Sublime Text", command: "subl", type: "external" },
    { id: "windsurf", name: "Windsurf", command: "windsurf", type: "external" },
    { id: "webstorm", name: "WebStorm", command: "webstorm", type: "external" },
    { id: "idea", name: "IntelliJ IDEA", command: "idea", type: "external" },
];

describe("detectEditors", () => {
    it("detected editors contain resolved commands and unchanged metadata", async () => {
        const calls: string[] = [];
        let resolving = false;
        const editors = await detectEditors({
            async resolve(editor) {
                expect(resolving).toBe(false);
                resolving = true;
                calls.push(editor.id);
                await Promise.resolve();
                resolving = false;
                return `/resolved/${editor.command}`;
            },
        });
        expect(editors).toEqual(
            expectedCatalog.map((editor) => ({
                ...editor,
                command: `/resolved/${editor.command}`,
            })),
        );
        expect(calls).toEqual(expectedCatalog.map((editor) => editor.id));
    });

    it("internal line flags and extra args survive resolution", async () => {
        const editors = await detectEditors({
            resolve: async (editor) => `/bin/${editor.command}`,
        });
        expect(editors.find((editor) => editor.id === "emacs")).toEqual({
            id: "emacs",
            name: "Emacs",
            command: "/bin/emacs",
            type: "internal",
            lineFlag: "+{line}",
            extraArgs: ["-nw"],
        });
        expect(editors.find((editor) => editor.id === "helix")).toEqual({
            id: "helix",
            name: "Helix",
            command: "/bin/hx",
            type: "internal",
            lineFlag: "{file}:{line}",
        });
    });

    it("a second detection cannot mutate the catalog", async () => {
        const resolve = async (editor: Pick<EditorInfo, "id" | "name" | "command">) =>
            `/resolved/${editor.command}`;
        const first = await detectEditors({ resolve });
        const emacs = first.find((editor) => editor.id === "emacs")!;
        emacs.extraArgs!.push("--changed");
        first[0].name = "changed";
        first[0].command = "changed";
        const second = await detectEditors({ resolve });
        expect(second).toEqual(
            expectedCatalog.map((editor) => ({
                ...editor,
                command: `/resolved/${editor.command}`,
            })),
        );
    });

    it("an unresolved editor is omitted", async () => {
        const editors = await detectEditors({
            resolve: async (editor) => (editor.id === "vscode" ? "/bundle/code" : null),
        });
        expect(editors).toEqual([
            { id: "vscode", name: "VS Code", command: "/bundle/code", type: "external" },
        ]);
    });
});
