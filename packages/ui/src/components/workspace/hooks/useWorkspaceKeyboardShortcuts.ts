import { useEffect } from "react";
import { isDialogOpen } from "@/lib/global-shortcuts";
import { useUIStore } from "@/stores/ui-store";

interface KeyboardShortcutHandlers {
    handleCloseActiveTab: () => void;
    handleOpenNewTask: () => void;
    handleOpenDefaultTerminal: () => Promise<void>;
    isElectron: boolean;
}

function useWorkspaceKeyboardShortcuts({
    handleCloseActiveTab,
    handleOpenNewTask,
    handleOpenDefaultTerminal,
    isElectron,
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

        const needsCloseTabFallback = !onCloseTab;
        const needsNewTaskFallback = !onNewTask;
        const needsNewTerminalFallback = !onNewTerminal;
        const needsFileExplorerFallback = !window.taskflow?.onToggleFileExplorer;
        const needsTaskInfoFallback = !window.taskflow?.onToggleTaskInfo;

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

            if (needsFileExplorerFallback && e.key.toLowerCase() === "e") {
                e.preventDefault();
                toggleFileExplorer();
                return;
            }

            if (needsTaskInfoFallback && e.key.toLowerCase() === "i") {
                e.preventDefault();
                toggleTaskInfo();
            }
        };

        if (
            needsCloseTabFallback ||
            needsNewTaskFallback ||
            needsNewTerminalFallback ||
            needsFileExplorerFallback ||
            needsTaskInfoFallback
        ) {
            window.addEventListener("keydown", onKeyDown);
        }

        return () => {
            cleanupFns.forEach((cleanup) => cleanup());
            if (
                needsCloseTabFallback ||
                needsNewTaskFallback ||
                needsNewTerminalFallback ||
                needsFileExplorerFallback ||
                needsTaskInfoFallback
            ) {
                window.removeEventListener("keydown", onKeyDown);
            }
        };
    }, [
        isElectron,
        handleCloseActiveTab,
        handleOpenDefaultTerminal,
        handleOpenNewTask,
        openSettings,
        openShortcutsDialog,
        openAgentOperationsHelp,
        toggleAppearance,
        toggleFlowManagement,
        toggleScheduleManagement,
        toggleFileExplorer,
        toggleTaskInfo,
    ]);
}

export { useWorkspaceKeyboardShortcuts };
