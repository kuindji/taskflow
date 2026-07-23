import { MSG } from "@taskflow/shared";
import type { ObsidianState } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

/**
 * `obsidian://open?path=<absolute path>` resolves against Obsidian's registered
 * vaults and opens whatever the path names — on a `.md` file, that page; on a
 * folder, the vault. Pass the page path whenever there is one.
 */
function openInObsidian(absolutePath: string): void {
    void window.taskflow?.openExternalUrl(
        `obsidian://open?path=${encodeURIComponent(absolutePath)}`,
    );
}

/** Ask the backend about Obsidian for a wiki root. Hits the disk — call on demand. */
function fetchObsidianState(root: string): Promise<ObsidianState> {
    return sendRequest<ObsidianState>(MSG.WIKI_OBSIDIAN_STATE, { root });
}

export { fetchObsidianState, openInObsidian };
