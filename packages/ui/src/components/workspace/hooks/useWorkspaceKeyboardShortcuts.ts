import { useEffect } from "react";
import { isDialogOpen } from "@/lib/global-shortcuts";
import { useUIStore } from "@/stores/ui-store";
import { useSessionStore } from "@/stores/session-store";
import { useMarkdownInputStore } from "@/stores/markdown-input-store";

interface KeyboardShortcutHandlers {
    handleCloseActiveTab: () => void;
    handleOpenNewTask: () => void;
    handleOpenDefaultTerminal: () => Promise<void>;
    handleOpenDefaultAgent: () => Promise<void>;
    isElectron: boolean;
    workspaceKey: string | null;
}

function useWorkspaceKeyboardShortcuts({
    handleCloseActiveTab,
    handleOpenNewTask,
    handleOpenDefaultTerminal,
    handleOpenDefaultAgent,
    isElectron,
    workspaceKey,
}: KeyboardShortcutHandlers) {
    const openSettings = useUIStore((s) => s.openSettings);
    const openShortcutsDialog = useUIStore((s) => s.openShortcutsDialog);
    const openAgentOperationsHelp = useUIStore((s) => s.openAgentOperationsHelp);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);
    const toggleAppearance = useUIStore((s) => s.toggleAppearance);
    const toggleFileExplorer = useUIStore((s) => s.toggleFileExplorer);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);

    useEffect(() => {
        const cleanupFns: Array<() => void> = [];
        const onCloseTab = isElectron ? window.taskflow?.onCloseTab : undefined;
        const onNewTask = isElectron ? window.taskflow?.onNewTask : undefined;
        const onNewTerminal = isElectron ? window.taskflow?.onNewTerminal : undefined;
        const onOpenSettings = isElectron ? window.taskflow?.onOpenSettings : undefined;
        const onOpenKeyboardShortcuts = isElectron
            ? window.taskflow?.onOpenKeyboardShortcuts
            : undefined;
        const onOpenAgentOperationsHelp = isElectron
            ? window.taskflow?.onOpenAgentOperationsHelp
            : undefined;
        const onOpenAppearance = isElectron ? window.taskflow?.onOpenAppearance : undefined;
        const onOpenFlows = isElectron ? window.taskflow?.onOpenFlows : undefined;
        const onOpenSchedules = isElectron ? window.taskflow?.onOpenSchedules : undefined;

        const runIfNoDialogOpen = (action: () => void) => () => {
            if (isDialogOpen()) return;
            action();
        };

        if (onCloseTab) {
            cleanupFns.push(onCloseTab(runIfNoDialogOpen(handleCloseActiveTab)));
        }
        if (onNewTask) {
            cleanupFns.push(onNewTask(runIfNoDialogOpen(handleOpenNewTask)));
        }
        if (onNewTerminal) {
            cleanupFns.push(
                onNewTerminal(runIfNoDialogOpen(() => void handleOpenDefaultTerminal())),
            );
        }

        const onNewAgent = isElectron ? window.taskflow?.onNewAgent : undefined;
        if (onNewAgent) {
            cleanupFns.push(onNewAgent(runIfNoDialogOpen(() => void handleOpenDefaultAgent())));
        }
        if (onOpenSettings) {
            cleanupFns.push(onOpenSettings(runIfNoDialogOpen(openSettings)));
        }
        if (onOpenKeyboardShortcuts) {
            cleanupFns.push(onOpenKeyboardShortcuts(runIfNoDialogOpen(openShortcutsDialog)));
        }
        if (onOpenAgentOperationsHelp) {
            cleanupFns.push(onOpenAgentOperationsHelp(runIfNoDialogOpen(openAgentOperationsHelp)));
        }
        if (onOpenAppearance) {
            cleanupFns.push(onOpenAppearance(runIfNoDialogOpen(toggleAppearance)));
        }
        if (onOpenFlows) {
            cleanupFns.push(onOpenFlows(runIfNoDialogOpen(toggleFlowManagement)));
        }
        if (onOpenSchedules) {
            cleanupFns.push(onOpenSchedules(runIfNoDialogOpen(toggleScheduleManagement)));
        }

        const onToggleMarkdownInput = isElectron
            ? window.taskflow?.onToggleMarkdownInput
            : undefined;

        if (onToggleMarkdownInput) {
            cleanupFns.push(
                onToggleMarkdownInput(
                    runIfNoDialogOpen(() => {
                        if (!workspaceKey) return;
                        const activeTab = useSessionStore.getState().getActiveTab(workspaceKey);
                        if (activeTab?.sessionId) {
                            useMarkdownInputStore.getState().toggle(activeTab.sessionId);
                        }
                    }),
                ),
            );
        }

        const needsCloseTabFallback = !onCloseTab;
        const needsNewTaskFallback = !onNewTask;
        const needsNewTerminalFallback = !onNewTerminal;
        const needsNewAgentFallback = !onNewAgent;
        const needsFileExplorerFallback = !window.taskflow?.onToggleFileExplorer;
        const needsTaskInfoFallback = !window.taskflow?.onToggleTaskInfo;
        const needsMarkdownInputFallback = !onToggleMarkdownInput;

        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            if (isDialogOpen()) return;

            if (needsCloseTabFallback && e.key.toLowerCase() === "w") {
                e.preventDefault();
                handleCloseActiveTab();
                return;
            }

            if (needsNewTaskFallback && e.key.toLowerCase() === "n") {
                e.preventDefault();
                handleOpenNewTask();
                return;
            }

            if (needsNewTerminalFallback && e.key.toLowerCase() === "t") {
                e.preventDefault();
                void handleOpenDefaultTerminal();
                return;
            }

            if (needsNewAgentFallback && e.key.toLowerCase() === "j") {
                e.preventDefault();
                void handleOpenDefaultAgent();
                return;
            }

            if (e.shiftKey && needsMarkdownInputFallback && e.code === "KeyE") {
                e.preventDefault();
                if (workspaceKey) {
                    const activeTab = useSessionStore.getState().getActiveTab(workspaceKey);
                    if (activeTab?.sessionId) {
                        useMarkdownInputStore.getState().toggle(activeTab.sessionId);
                    }
                }
                return;
            }

            if (needsFileExplorerFallback && !e.shiftKey && e.key.toLowerCase() === "e") {
                e.preventDefault();
                toggleFileExplorer();
                return;
            }

            if (needsTaskInfoFallback && !e.shiftKey && e.key.toLowerCase() === "i") {
                e.preventDefault();
                toggleTaskInfo();
                return;
            }

            // Cmd+1-9: workspace tab switching (only when workspace is focused
            // and not in panel navigation mode)
            if (!e.shiftKey && !e.altKey) {
                const digit = parseInt(e.key, 10);
                if (digit >= 1 && digit <= 9) {
                    const state = useUIStore.getState();
                    if (
                        state.focusedPanel === "workspace" &&
                        !state.navigationMode &&
                        workspaceKey
                    ) {
                        e.preventDefault();
                        const tabs = useSessionStore.getState().tabsByWorkspace[workspaceKey];
                        if (tabs && digit <= tabs.length) {
                            useSessionStore
                                .getState()
                                .setActiveTab(workspaceKey, tabs[digit - 1].id);
                        }
                    }
                }
            }
        };

        window.addEventListener("keydown", onKeyDown);

        return () => {
            cleanupFns.forEach((cleanup) => cleanup());
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [
        isElectron,
        handleCloseActiveTab,
        handleOpenDefaultTerminal,
        handleOpenDefaultAgent,
        handleOpenNewTask,
        openSettings,
        openShortcutsDialog,
        openAgentOperationsHelp,
        toggleAppearance,
        toggleFlowManagement,
        toggleScheduleManagement,
        toggleFileExplorer,
        toggleTaskInfo,
        workspaceKey,
    ]);
}

export { useWorkspaceKeyboardShortcuts };
