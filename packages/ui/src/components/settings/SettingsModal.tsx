import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { sendRequest } from "@/hooks/useWebSocket";
import {
    MSG,
    ALL_AGENT_TYPES,
    type AgentType,
    type ShellInfo,
    type ShellListResponse,
    type RuntimeInfo,
    type RuntimeListResponse,
    type ClaudeSettings,
    type GeminiSettings,
    type EditorInfo,
    type SystemInfoResponse,
} from "@taskflow/shared";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { alert, confirm } from "@/stores/dialog-store";
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
import { useRemoteAgentStatus } from "@/hooks/useRemoteAgentStatus";
import { GeneralSection } from "./sections/GeneralSection";
import { DefaultsSection } from "./sections/DefaultsSection";
import { AgentSection } from "./sections/AgentSection";
import { CodexSection } from "./sections/CodexSection";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { RemoteSection } from "./sections/RemoteSection";

type SectionKey =
    | "general"
    | "defaults"
    | "claude"
    | "codex"
    | "opencode"
    | "gemini"
    | "cursor"
    | "remote-agent";

function SettingsModal() {
    const open = useUIStore((s) => s.settingsOpen);
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const settings = useSettingsStore((s) => s.settings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const dataDirInfo = useSettingsStore((s) => s.dataDirInfo);
    const fetchDataDir = useSettingsStore((s) => s.fetchDataDir);
    const updateDataDir = useSettingsStore((s) => s.updateDataDir);
    const [shells, setShells] = useState<ShellInfo[]>([]);
    const [systemShellPath, setSystemShellPath] = useState<string | null>(null);
    const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
    const [systemEditors, setSystemEditors] = useState<EditorInfo[]>([]);
    const [section, setSection] = useState<SectionKey>("general");
    const agents = useAgentAvailability();
    const claudeAvailable = isAgentAvailable(agents, "claude");
    const remoteAgent = useRemoteAgentStatus();
    const [migrating, setMigrating] = useState(false);
    const [migrationError, setMigrationError] = useState<string | null>(null);
    const [conflictPath, setConflictPath] = useState<string | null>(null);
    const migrationErrorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    useEffect(() => {
        if (!open) return;

        void fetchDataDir();

        sendRequest<ShellListResponse>(MSG.SHELLS_LIST, {}).then(
            (response) => {
                setShells(response.shells);
                setSystemShellPath(response.systemShellPath);
            },
            () => {
                setShells([]);
                setSystemShellPath(null);
            },
        );

        sendRequest<RuntimeListResponse>(MSG.RUNTIMES_LIST, {}).then(
            (response) => setRuntimes(response.runtimes),
            () => setRuntimes([]),
        );

        sendRequest<SystemInfoResponse>(MSG.SYSTEM_INFO, {}).then(
            (info) => setSystemEditors(info.editors),
            () => {},
        );
    }, [open, fetchDataDir]);

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleSettings();
        },
        [toggleSettings],
    );

    // --- General section handlers ---

    const showMigrationError = useCallback((message: string) => {
        setMigrationError(message);
        clearTimeout(migrationErrorTimer.current);
        migrationErrorTimer.current = setTimeout(() => setMigrationError(null), 5000);
    }, []);

    const showDataDirChangedAlert = useCallback((previousPath: string, nextPath: string) => {
        if (previousPath === nextPath) return;

        void alert({
            title: "Data Folder Changed",
            description: `Taskflow is now using "${nextPath}" instead of "${previousPath}" for projects, tasks, and session data.`,
        });
    }, []);

    const confirmDataDirChange = useCallback(
        async (nextPath: string, action: "change" | "reset") => {
            const currentPath = dataDirInfo?.dataDir;
            if (!currentPath) return false;

            const confirmed = await confirm({
                title: action === "reset" ? "Reset Data Folder?" : "Change Data Folder?",
                description:
                    action === "reset"
                        ? `Taskflow will move your projects, tasks, and session data from "${currentPath}" back to the default folder at "${nextPath}". Config files will remain in ~/.config/taskflow. If the destination already contains Taskflow data, you'll be asked how to proceed.`
                        : `Taskflow will move your projects, tasks, and session data from "${currentPath}" to "${nextPath}". Config files will remain in ~/.config/taskflow. If the destination already contains Taskflow data, you'll be asked how to proceed.`,
                confirmLabel: action === "reset" ? "Reset Folder" : "Move Data",
                cancelLabel: "Cancel",
            });

            return confirmed;
        },
        [dataDirInfo?.dataDir],
    );

    const handleChangeDataDir = useCallback(async () => {
        const selected = await window.taskflow?.selectProjectDirectory();
        if (!selected) return;
        if (selected === dataDirInfo?.dataDir) return;
        const confirmed = await confirmDataDirChange(selected, "change");
        if (!confirmed) return;
        const previousPath = dataDirInfo?.dataDir;
        setMigrating(true);
        setMigrationError(null);
        try {
            const result = await updateDataDir(selected);
            if (result.conflict) {
                setConflictPath(selected);
            } else if (previousPath) {
                showDataDirChangedAlert(previousPath, result.dataDir);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to change data folder";
            showMigrationError(message);
        } finally {
            setMigrating(false);
        }
    }, [
        confirmDataDirChange,
        dataDirInfo?.dataDir,
        updateDataDir,
        showMigrationError,
        showDataDirChangedAlert,
    ]);

    const handleResetDataDir = useCallback(async () => {
        if (!dataDirInfo?.baseDir) return;
        const confirmed = await confirmDataDirChange(dataDirInfo.baseDir, "reset");
        if (!confirmed) return;
        const previousPath = dataDirInfo.dataDir;
        setMigrating(true);
        setMigrationError(null);
        try {
            const result = await updateDataDir(dataDirInfo.baseDir);
            if (result.conflict) {
                setConflictPath(dataDirInfo.baseDir);
            } else {
                showDataDirChangedAlert(previousPath, result.dataDir);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to reset data folder";
            showMigrationError(message);
        } finally {
            setMigrating(false);
        }
    }, [
        confirmDataDirChange,
        dataDirInfo,
        updateDataDir,
        showMigrationError,
        showDataDirChangedAlert,
    ]);

    const handleConflictChoice = useCallback(
        async (mode: "overwrite" | "adopt") => {
            if (!conflictPath || !dataDirInfo?.dataDir) return;
            const previousPath = dataDirInfo.dataDir;
            setConflictPath(null);
            setMigrating(true);
            setMigrationError(null);
            try {
                const result = await updateDataDir(conflictPath, mode);
                showDataDirChangedAlert(previousPath, result.dataDir);
            } catch (err) {
                const message = err instanceof Error ? err.message : "Failed to change data folder";
                showMigrationError(message);
            } finally {
                setMigrating(false);
            }
        },
        [
            conflictPath,
            dataDirInfo?.dataDir,
            updateDataDir,
            showMigrationError,
            showDataDirChangedAlert,
        ],
    );

    // --- Defaults section handlers ---

    const handleDefaultShell = useCallback(
        (defaultShell: string) => {
            void updateSettings({ terminal: { defaultShell } });
        },
        [updateSettings],
    );

    const handleExternalEditor = useCallback(
        (value: string) => updateSettings({ editor: { externalEditor: value } }),
        [updateSettings],
    );

    const handleInternalEditor = useCallback(
        (value: string) => updateSettings({ editor: { internalEditor: value } }),
        [updateSettings],
    );

    const handleDefaultAgent = useCallback(
        (value: string) => {
            if (
                value === "claude" ||
                value === "codex" ||
                value === "opencode" ||
                value === "gemini" ||
                value === "cursor"
            ) {
                void updateSettings({ general: { defaultAgent: value } });
            }
        },
        [updateSettings],
    );

    const handleToggleFavoriteAgent = useCallback(
        (agent: AgentType, checked: boolean) => {
            const current = settings?.general.favoriteAgents ?? ALL_AGENT_TYPES;
            const next = checked
                ? current.includes(agent)
                    ? current
                    : [...current, agent]
                : current.filter((a) => a !== agent);
            void updateSettings({ general: { favoriteAgents: next } });
        },
        [settings?.general.favoriteAgents, updateSettings],
    );

    const handleDefaultRuntime = useCallback(
        (defaultRuntime: string) => {
            void updateSettings({ general: { defaultRuntime } });
        },
        [updateSettings],
    );

    // --- Agent section handlers ---

    const handleClaudeModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ claude: { defaultModel } });
        },
        [updateSettings],
    );

    const handleClaudeEffort = useCallback(
        (defaultEffort: string) => {
            void updateSettings({
                claude: { defaultEffort: defaultEffort as ClaudeSettings["defaultEffort"] },
            });
        },
        [updateSettings],
    );

    const handleClaudeSkipPermissions = useCallback(
        (dangerouslySkipPermissions: boolean) => {
            void updateSettings({ claude: { dangerouslySkipPermissions } });
        },
        [updateSettings],
    );

    const handleClaudePermissionMode = useCallback(
        (permissionMode: string) => {
            void updateSettings({
                claude: { permissionMode: permissionMode as ClaudeSettings["permissionMode"] },
            });
        },
        [updateSettings],
    );

    const handleCodexFullAuto = useCallback(
        (fullAuto: boolean) => {
            void updateSettings({ codex: { fullAuto } });
        },
        [updateSettings],
    );

    const handleCodexSandbox = useCallback(
        (sandbox: string) => {
            void updateSettings({ codex: { sandbox } });
        },
        [updateSettings],
    );

    const handleCodexApprovalPolicy = useCallback(
        (approvalPolicy: string) => {
            void updateSettings({ codex: { approvalPolicy } });
        },
        [updateSettings],
    );

    const handleCodexModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ codex: { defaultModel } });
        },
        [updateSettings],
    );

    const handleOpencodeModel = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            void updateSettings({ opencode: { defaultModel: e.target.value } });
        },
        [updateSettings],
    );

    const handleOpencodeFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ opencode: { fullAccess } });
        },
        [updateSettings],
    );

    const handleOpencodeDontAsk = useCallback(
        (dontAskQuestions: boolean) => {
            void updateSettings({
                opencode: {
                    dontAskQuestions,
                    ...(dontAskQuestions ? { fullAccess: true } : {}),
                },
            });
        },
        [updateSettings],
    );

    const handleGeminiModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({
                gemini: { defaultModel: defaultModel as GeminiSettings["defaultModel"] },
            });
        },
        [updateSettings],
    );

    const handleGeminiFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ gemini: { fullAccess } });
        },
        [updateSettings],
    );

    const handleGeminiDontAsk = useCallback(
        (dontAskQuestions: boolean) => {
            void updateSettings({
                gemini: {
                    dontAskQuestions,
                    ...(dontAskQuestions ? { fullAccess: true } : {}),
                },
            });
        },
        [updateSettings],
    );

    const handleCursorModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ cursor: { defaultModel: defaultModel || "default" } });
        },
        [updateSettings],
    );

    const handleCursorFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ cursor: { fullAccess } });
        },
        [updateSettings],
    );

    const handleCursorDontAsk = useCallback(
        (dontAskQuestions: boolean) => {
            void updateSettings({
                cursor: {
                    dontAskQuestions,
                    ...(dontAskQuestions ? { fullAccess: true } : {}),
                },
            });
        },
        [updateSettings],
    );

    // --- Remote section handler ---

    const handleRemoteUpdate = useCallback(
        (partial: Partial<{ autoStart: boolean; appName: string; headless: boolean }>) => {
            void updateSettings({ remoteAgent: partial });
        },
        [updateSettings],
    );

    if (!settings) return null;

    const navItems: { key: SectionKey; label: string }[] = [
        { key: "general", label: "General" },
        { key: "defaults", label: "Defaults" },
        { key: "claude", label: "Claude" },
        { key: "codex", label: "Codex" },
        { key: "opencode", label: "OpenCode" },
        { key: "gemini", label: "Gemini" },
        { key: "cursor", label: "Cursor" },
        ...(claudeAvailable ? [{ key: "remote-agent" as const, label: "Remote Agent" }] : []),
    ];

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="bg-dialog-shell border-border flex max-h-[min(32rem,calc(100vh-2rem))] w-[min(40rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl p-1.5 sm:max-w-3xl"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Settings</DialogTitle>
                </DialogHeader>

                <div className="flex h-[400px] min-h-0 gap-1.5">
                    {/* Sidebar */}
                    <nav className="bg-card w-[148px] shrink-0 overflow-y-auto rounded-[10px] p-1.5">
                        {navItems.map((item) => (
                            <button
                                key={item.key}
                                className={`mb-px block w-full rounded-md px-3 py-[7px] text-left text-[13px] transition-colors ${
                                    section === item.key
                                        ? "bg-muted text-foreground font-medium"
                                        : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted/50"
                                }`}
                                onClick={() => setSection(item.key)}>
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    {/* Content */}
                    <div className="bg-background h-full min-h-0 min-w-0 flex-1 overflow-hidden rounded-[10px] py-1">
                        {section === "general" && (
                            <GeneralSection
                                dataDirInfo={dataDirInfo}
                                migrating={migrating}
                                migrationError={migrationError}
                                onChangeDataDir={() => void handleChangeDataDir()}
                                onResetDataDir={() => void handleResetDataDir()}
                            />
                        )}

                        {section === "defaults" && (
                            <div className="h-full overflow-y-auto px-3">
                                <DefaultsSection
                                    settings={settings}
                                    shells={shells}
                                    systemShellPath={systemShellPath}
                                    runtimes={runtimes}
                                    systemEditors={systemEditors}
                                    agents={agents}
                                    onInternalEditor={handleInternalEditor}
                                    onExternalEditor={handleExternalEditor}
                                    onDefaultAgent={handleDefaultAgent}
                                    onToggleFavoriteAgent={handleToggleFavoriteAgent}
                                    onDefaultShell={handleDefaultShell}
                                    onDefaultRuntime={handleDefaultRuntime}
                                />
                            </div>
                        )}

                        {section === "claude" && (
                            <div className="px-3">
                                <ClaudeOptions
                                    mode="defaults"
                                    modelValue={settings.claude.defaultModel}
                                    effortValue={settings.claude.defaultEffort}
                                    dangerouslySkipPermissions={
                                        settings.claude.dangerouslySkipPermissions
                                    }
                                    permissionMode={settings.claude.permissionMode}
                                    onModelChange={handleClaudeModel}
                                    onEffortChange={handleClaudeEffort}
                                    onSkipPermissions={handleClaudeSkipPermissions}
                                    onPermissionModeChange={handleClaudePermissionMode}
                                />
                            </div>
                        )}

                        {section === "codex" && (
                            <div className="px-3">
                                <CodexSection
                                    defaultModel={settings.codex.defaultModel}
                                    sandbox={settings.codex.sandbox}
                                    approvalPolicy={settings.codex.approvalPolicy}
                                    fullAuto={settings.codex.fullAuto}
                                    onModelChange={handleCodexModel}
                                    onSandboxChange={handleCodexSandbox}
                                    onApprovalPolicyChange={handleCodexApprovalPolicy}
                                    onFullAutoChange={handleCodexFullAuto}
                                />
                            </div>
                        )}

                        {section === "opencode" && (
                            <div className="px-3">
                                <AgentSection
                                    agentKey="opencode"
                                    fullAccess={settings.opencode.fullAccess}
                                    dontAskQuestions={settings.opencode.dontAskQuestions}
                                    onFullAccess={handleOpencodeFullAccess}
                                    onDontAsk={handleOpencodeDontAsk}
                                    modelValue={settings.opencode.defaultModel}
                                    modelInputPlaceholder="e.g. anthropic/claude-sonnet-4-20250514"
                                    onModelInputChange={handleOpencodeModel}
                                    fullAccessHint="Auto-approve all tool permissions by default"
                                />
                            </div>
                        )}

                        {section === "gemini" && (
                            <div className="px-3">
                                <AgentSection
                                    agentKey="gemini"
                                    fullAccess={settings.gemini.fullAccess}
                                    dontAskQuestions={settings.gemini.dontAskQuestions}
                                    onFullAccess={handleGeminiFullAccess}
                                    onDontAsk={handleGeminiDontAsk}
                                    modelValue={settings.gemini.defaultModel}
                                    modelOptions={[
                                        { value: "default", label: "Default" },
                                        { value: "auto", label: "Auto" },
                                        { value: "pro", label: "Pro" },
                                        { value: "flash", label: "Flash" },
                                        { value: "flash-lite", label: "Flash Lite" },
                                    ]}
                                    onModelChange={handleGeminiModel}
                                    fullAccessHint="Auto-approve all actions by default"
                                />
                            </div>
                        )}

                        {section === "cursor" && (
                            <div className="px-3">
                                <AgentSection
                                    agentKey="cursor"
                                    fullAccess={settings.cursor.fullAccess}
                                    dontAskQuestions={settings.cursor.dontAskQuestions}
                                    onFullAccess={handleCursorFullAccess}
                                    onDontAsk={handleCursorDontAsk}
                                    modelValue={
                                        settings.cursor.defaultModel === "default"
                                            ? ""
                                            : settings.cursor.defaultModel
                                    }
                                    modelInputPlaceholder="default"
                                    onModelInputChange={(e) => handleCursorModel(e.target.value)}
                                    fullAccessHint="Run in yolo mode by default (auto-approve commands)"
                                />
                            </div>
                        )}

                        {section === "remote-agent" && (
                            <div className="px-3">
                                <RemoteSection
                                    settings={settings.remoteAgent}
                                    remoteAgent={remoteAgent}
                                    onUpdate={handleRemoteUpdate}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
            <AlertDialog
                open={conflictPath !== null}
                onOpenChange={(open) => {
                    if (!open) setConflictPath(null);
                }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Existing Data Found</AlertDialogTitle>
                        <AlertDialogDescription>
                            The selected folder already contains Taskflow data. How would you like
                            to proceed?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={() => setConflictPath(null)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => void handleConflictChoice("overwrite")}>
                            Overwrite
                        </Button>
                        <Button onClick={() => void handleConflictChoice("adopt")}>
                            Use Existing
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}

export { SettingsModal };
