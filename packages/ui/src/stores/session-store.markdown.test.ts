import { beforeEach, describe, expect, it } from "bun:test";
import { useSessionStore } from "./session-store";

const KEY = "task:t1";

function seedMarkdownTab(): string {
    const id = "tab-1";
    useSessionStore.setState({
        tabsByWorkspace: {
            [KEY]: [
                {
                    id,
                    type: "markdown",
                    label: "doc.md",
                    filePath: "/w/doc.md",
                    mode: "preview",
                    history: ["/w/doc.md"],
                    historyIndex: 0,
                },
            ],
        },
        activeTabByWorkspace: { [KEY]: id },
    });
    return id;
}

function readTab(id: string) {
    return useSessionStore.getState().tabsByWorkspace[KEY]?.find((t) => t.id === id);
}

describe("markdown tab state", () => {
    beforeEach(() => {
        useSessionStore.setState({ tabsByWorkspace: {}, activeTabByWorkspace: {} });
    });

    it("stores the preview scroll offset on the tab", () => {
        const id = seedMarkdownTab();
        useSessionStore.getState().setTabScrollTop(KEY, id, 640);
        expect(readTab(id)?.previewScrollTop).toBe(640);
    });

    it("keeps the scroll offset when the tab swaps to edit mode and back", () => {
        const id = seedMarkdownTab();
        const store = useSessionStore.getState();
        store.setTabScrollTop(KEY, id, 640);
        store.setTabMode(KEY, id, "edit");
        expect(readTab(id)?.previewScrollTop).toBe(640);
        store.setTabMode(KEY, id, "preview");
        expect(readTab(id)?.previewScrollTop).toBe(640);
        expect(readTab(id)?.mode).toBe("preview");
    });

    it("leaves the tab array reference untouched when the offset is unchanged", () => {
        const id = seedMarkdownTab();
        useSessionStore.getState().setTabScrollTop(KEY, id, 100);
        const before = useSessionStore.getState().tabsByWorkspace[KEY];
        useSessionStore.getState().setTabScrollTop(KEY, id, 100);
        expect(useSessionStore.getState().tabsByWorkspace[KEY]).toBe(before);
    });

    it("ignores writes for an unknown workspace or tab", () => {
        const id = seedMarkdownTab();
        const before = useSessionStore.getState().tabsByWorkspace;
        useSessionStore.getState().setTabScrollTop("task:nope", id, 10);
        useSessionStore.getState().setTabScrollTop(KEY, "nope", 10);
        expect(useSessionStore.getState().tabsByWorkspace).toBe(before);
    });
});
