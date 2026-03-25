import { useCallback } from "react";
import type { ShellListResponse } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { Tab } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useTaskStore } from "@/stores/task-store";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { useUIStore } from "@/stores/ui-store";
import { sendRequest } from "@/hooks/useWebSocket";
import { destroyTerminal } from "@/components/panes/TerminalPane";
import { getShellSessionLabel, resolveTerminalShellPath } from "@/lib/terminal-shells";
import type { useActiveWorkspace } from "@/hooks/useActiveWorkspace";

type Workspace = ReturnType<typeof useActiveWorkspace>;

interface TabOpsParams {
    workspace: Workspace;
    activeTab: Tab | undefined;
    defaultShellPath: string | null;
    configuredShell: string;
}

interface TabOpsResult {
    handleCloseActiveTab: () => void;
    handleOpenNewTask: () => void;
    handleOpenDefaultTerminal: () => Promise<void>;
}

function useWorkspaceTabOps({
    workspace,
    activeTab,
    defaultShellPath,
    configuredShell,
}: TabOpsParams): TabOpsResult {
    const closeTab = useSessionStore((s) => s.closeTab);
    const createSession = useSessionStore((s) => s.createSession);
    const setActiveTask = useTaskStore((s) => s.setActiveTask);
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);

    const handleCloseActiveTab = useCallback(() => {
        if (activeTab && workspace.workspaceKey) {
            if (activeTab.sessionId) destroyTerminal(activeTab.sessionId);
            void closeTab(workspace.workspaceKey, activeTab.id);
        } else if (workspace.scope === "task") {
            setActiveTask(null);
        } else if (workspace.scope === "project") {
            setActiveProject(null);
        }
    }, [
        activeTab,
        workspace.workspaceKey,
        workspace.scope,
        closeTab,
        setActiveTask,
        setActiveProject,
    ]);

    const handleOpenNewTask = useCallback(() => {
        requestNewTask();
    }, [requestNewTask]);

    const handleOpenDefaultTerminal = useCallback(async () => {
        if (!workspace.scope) return;

        let shell = defaultShellPath;
        if (!shell) {
            const res = await sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {});
            shell = resolveTerminalShellPath(res.shells, res.systemShellPath, configuredShell);
        }
        if (!shell) return;

        const owner =
            workspace.scope === "task"
                ? { taskId: workspace.task.id }
                : workspace.scope === "project"
                  ? { projectId: workspace.project.id }
                  : { master: true as const };
        setFocusedPanel("workspace");
        await createSession(owner, "shell", getShellSessionLabel(shell), undefined, shell);
    }, [
        configuredShell,
        createSession,
        defaultShellPath,
        setFocusedPanel,
        workspace.project,
        workspace.scope,
        workspace.task,
    ]);

    return {
        handleCloseActiveTab,
        handleOpenNewTask,
        handleOpenDefaultTerminal,
    };
}

export { useWorkspaceTabOps };
