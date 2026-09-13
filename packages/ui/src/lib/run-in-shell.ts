import type { ShellListResponse } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { useSessionStore } from "@/stores/session-store";
import { resolveTerminalShellPath } from "@/lib/terminal-shells";

interface RunInShellOptions {
    /** The owner's machine: the shell is resolved and started there. */
    backendId: string;
    owner: { taskId?: string; projectId?: string; master?: boolean };
    configuredShell: string;
    label: string;
    command?: string;
    targetWorkspaceKey?: string;
}

/**
 * Resolves the configured shell, creates a shell session, and optionally sends
 * an initial command. Returns the created session ID, or null if no shell could
 * be resolved.
 */
async function runInShell({
    backendId,
    owner,
    configuredShell,
    label,
    command,
    targetWorkspaceKey,
}: RunInShellOptions): Promise<string | null> {
    const res = await sendRequest<ShellListResponse>(backendId, MSG.SHELLS_LIST, {});
    const shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
    if (!shell) return null;

    const store = useSessionStore.getState();
    const sessionId = await store.createSession(
        { ...owner, backendId },
        "shell",
        label,
        undefined,
        shell,
        undefined,
        undefined,
        undefined,
        targetWorkspaceKey,
    );

    if (command) {
        store.sendInput(sessionId, command);
    }

    return sessionId;
}

export { runInShell };
