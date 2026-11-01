import { findSessionTab } from "@/stores/session-store";
import { useMarkdownInputStore } from "@/stores/markdown-input-store";

/**
 * Drop a session's input editor state once no tab shows the session. A
 * terminal unmounted by a workspace switch keeps its tab, and its draft.
 */
function releaseInputDraft(sessionId: string): void {
    if (findSessionTab(sessionId)) return;
    useMarkdownInputStore.getState().cleanup(sessionId);
}

export { releaseInputDraft };
