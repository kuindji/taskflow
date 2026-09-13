import { MSG } from "@taskflow/shared";
import type { ObsidianState } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";

/**
 * `obsidian://open?path=<absolute path>` resolves against Obsidian's registered
 * vaults and opens whatever the path names — on a `.md` file, that page; on a
 * folder, the vault. Pass the page path whenever there is one.
 *
 * The URL opens in this machine's Obsidian, so only offer it for a local backend.
 */
function openInObsidian(absolutePath: string): void {
    void window.taskflow?.openExternalUrl(
        `obsidian://open?path=${encodeURIComponent(absolutePath)}`,
    );
}

/** Ask a backend about Obsidian for a wiki root. Hits the disk — call on demand. */
function fetchObsidianState(backendId: string, root: string): Promise<ObsidianState> {
    return sendRequest<ObsidianState>(backendId, MSG.WIKI_OBSIDIAN_STATE, { root });
}

export { fetchObsidianState, openInObsidian };
