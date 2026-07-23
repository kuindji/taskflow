import { beforeEach, describe, expect, it } from "bun:test";
import { useUIStore } from "./ui-store";

describe("wiki panel toggle", () => {
    beforeEach(() => {
        useUIStore.setState({
            fileExplorerOpen: false,
            searchPanelOpen: false,
            wikiPanelOpen: false,
        });
    });

    it("opens the wiki panel and closes its siblings", () => {
        useUIStore.setState({ fileExplorerOpen: true });
        useUIStore.getState().toggleWikiPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(true);
        expect(useUIStore.getState().fileExplorerOpen).toBe(false);
    });

    it("closes the wiki panel when opening the file explorer", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleFileExplorer();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
        expect(useUIStore.getState().fileExplorerOpen).toBe(true);
    });

    it("closes the wiki panel when opening search", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleSearchPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
        expect(useUIStore.getState().searchPanelOpen).toBe(true);
    });

    it("toggles itself off", () => {
        useUIStore.getState().toggleWikiPanel();
        useUIStore.getState().toggleWikiPanel();
        expect(useUIStore.getState().wikiPanelOpen).toBe(false);
    });
});
