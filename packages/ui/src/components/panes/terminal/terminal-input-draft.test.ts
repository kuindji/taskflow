import { beforeEach, describe, expect, it } from "bun:test";
import { getEditor, useMarkdownInputStore } from "@/stores/markdown-input-store";
import { useSessionStore } from "@/stores/session-store";
import { releaseInputDraft } from "./terminal-input-draft";

describe("releaseInputDraft", () => {
    beforeEach(() => {
        useMarkdownInputStore.setState({
            editors: { s1: { buffer: "unsent prompt", isOpen: true } },
        });
    });

    it("keeps the draft of a session whose tab is in another workspace", () => {
        useSessionStore.setState({
            tabsByWorkspace: {
                "task:other": [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1" }],
            },
        });

        releaseInputDraft("s1");

        expect(getEditor(useMarkdownInputStore.getState(), "s1")).toEqual({
            buffer: "unsent prompt",
            isOpen: true,
        });
    });

    it("drops the draft once no tab shows the session", () => {
        useSessionStore.setState({ tabsByWorkspace: {} });

        releaseInputDraft("s1");

        expect(useMarkdownInputStore.getState().editors.s1).toBeUndefined();
    });
});
