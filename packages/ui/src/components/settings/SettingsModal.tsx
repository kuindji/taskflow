import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { sendRequest } from "@/hooks/useWebSocket";
import {
    getShellDisplayName,
    getTerminalShellSummary,
    isConfiguredShellAvailable,
} from "@/lib/terminal-shells";
import {
    DEFAULT_TERMINAL_SHELL,
    MSG,
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { alert, confirm } from "@/stores/dialog-store";
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
import { useRemoteAgentStatus } from "@/hooks/useRemoteAgentStatus";

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
    const [section, setSection] = useState<
        | "general"
        | "defaults"
        | "claude"
        | "codex"
        | "opencode"
        | "gemini"
        | "cursor"
        | "remote-agent"
    >("general");
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

    const handleClaudeModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({
                claude: { defaultModel: defaultModel as ClaudeSettings["defaultModel"] },
            });
        },
        [updateSettings],
    );

    const handleClaudeFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ claude: { fullAccess } });
        },
        [updateSettings],
    );

    const handleClaudeDontAsk = useCallback(
        (dontAskQuestions: boolean) => {
            void updateSettings({
                claude: {
                    dontAskQuestions,
                    ...(dontAskQuestions ? { fullAccess: true } : {}),
                },
            });
        },
        [updateSettings],
    );

    const handleCodexFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ codex: { fullAccess } });
        },
        [updateSettings],
    );

    const handleCodexDontAsk = useCallback(
        (dontAskQuestions: boolean) => {
            void updateSettings({
                codex: {
                    dontAskQuestions,
                    ...(dontAskQuestions ? { fullAccess: true } : {}),
                },
            });
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

    const handleCursorModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ cursor: { defaultModel: defaultModel || "default" } });
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

    if (!settings) return null;

    const configuredShellAvailable = isConfiguredShellAvailable(
        shells,
        settings.terminal.defaultShell,
    );

    const navItems: { key: typeof section; label: string }[] = [
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
                className="bg-dialog-shell border-border w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-1.5 sm:max-w-xl"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Settings</DialogTitle>
                </DialogHeader>

                <div className="flex gap-1.5">
                    {/* Sidebar */}
                    <nav className="bg-card w-[148px] shrink-0 rounded-[10px] p-1.5">
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
                    <div className="bg-background min-h-[360px] min-w-0 flex-1 rounded-[10px] py-1">
                        {section === "general" && (
                            <div className="hover:bg-island-base mx-1 flex flex-col gap-2 rounded-md px-3 py-3 transition-colors">
                                <div>
                                    <div className="text-secondary-foreground text-[13px] font-medium">
                                        Data Folder
                                    </div>
                                    <div className="text-muted-foreground text-[11px]">
                                        Location where projects, tasks, and session data are stored
                                    </div>
                                </div>
                                <TruncatedText
                                    as="code"
                                    tooltip
                                    tooltipSide="bottom"
                                    className="bg-card border-border text-muted-foreground flex h-8 w-full max-w-90 min-w-0 items-center overflow-x-auto rounded-md border px-2.5 font-mono text-xs"
                                    tooltipContent={dataDirInfo?.dataDir ?? "Loading..."}>
                                    {dataDirInfo?.dataDir ?? "Loading..."}
                                </TruncatedText>
                                <div className="flex flex-wrap gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={migrating}
                                        onClick={() => void handleChangeDataDir()}>
                                        {migrating ? "Moving..." : "Change..."}
                                    </Button>
                                    {dataDirInfo && !dataDirInfo.isDefault && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={migrating}
                                            onClick={() => void handleResetDataDir()}>
                                            Reset
                                        </Button>
                                    )}
                                </div>
                                {migrationError && (
                                    <p className="text-destructive text-xs">{migrationError}</p>
                                )}
                                {dataDirInfo && !dataDirInfo.isDefault && (
                                    <p className="text-muted-foreground text-xxs">
                                        Using custom location. Config files remain in
                                        ~/.config/taskflow.
                                    </p>
                                )}
                            </div>
                        )}

                        {section === "defaults" && (
                            <>
                                <SettingRow
                                    label="Internal Editor"
                                    hint="Opens files when clicking paths in the terminal">
                                    <Select
                                        value={settings.editor.internalEditor}
                                        onValueChange={(value) =>
                                            updateSettings({ editor: { internalEditor: value } })
                                        }>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="monaco">Monaco</SelectItem>
                                            {systemEditors
                                                .filter((e) => e.type === "internal")
                                                .map((e) => (
                                                    <SelectItem key={e.id} value={e.id}>
                                                        {e.name}
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <SettingRow
                                    label="External Editor"
                                    hint="Opens files when Cmd+clicking paths in the terminal">
                                    <Select
                                        value={settings.editor.externalEditor}
                                        onValueChange={handleExternalEditor}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="system">System Default</SelectItem>
                                            {systemEditors
                                                .filter((e) => e.type === "external")
                                                .map((e) => (
                                                    <SelectItem key={e.id} value={e.id}>
                                                        {e.name}
                                                    </SelectItem>
                                                ))}
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <SettingRow
                                    label="Default Agent"
                                    hint="Pre-selected for new tasks, titles, and commits">
                                    <Select
                                        value={settings.general.defaultAgent}
                                        onValueChange={handleDefaultAgent}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {ALL_AGENT_TYPES.map((agent) => {
                                                const available = isAgentAvailable(agents, agent);
                                                return (
                                                    <SelectItem
                                                        key={agent}
                                                        value={agent}
                                                        disabled={!available}>
                                                        {AGENT_DISPLAY_NAMES[agent]}
                                                        {!available ? " (not installed)" : ""}
                                                    </SelectItem>
                                                );
                                            })}
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <div className="hover:bg-island-base mx-1 flex flex-col gap-1 rounded-md px-5 py-3 transition-colors">
                                    <div>
                                        <div className="text-secondary-foreground text-[13px] font-medium">
                                            Toolbar Agents
                                        </div>
                                        <div className="text-muted-foreground text-[11px] leading-snug">
                                            Favorited agents appear as buttons in the workspace
                                            toolbar
                                        </div>
                                    </div>
                                    {ALL_AGENT_TYPES.filter((agent) =>
                                        isAgentAvailable(agents, agent),
                                    ).map((agent) => (
                                        <div
                                            key={agent}
                                            className="flex items-center justify-between py-0.5">
                                            <Label
                                                htmlFor={`toolbar-agent-${agent}`}
                                                className="text-secondary-foreground cursor-pointer text-[13px] font-normal normal-case">
                                                {AGENT_DISPLAY_NAMES[agent]}
                                            </Label>
                                            <Switch
                                                id={`toolbar-agent-${agent}`}
                                                checked={(
                                                    settings.general.favoriteAgents ??
                                                    ALL_AGENT_TYPES
                                                ).includes(agent)}
                                                onCheckedChange={(checked) =>
                                                    handleToggleFavoriteAgent(agent, checked)
                                                }
                                            />
                                        </div>
                                    ))}
                                </div>
                                <SettingRow
                                    label="Default Shell"
                                    hint="Default shell for new terminal tabs">
                                    <Select
                                        value={
                                            configuredShellAvailable
                                                ? settings.terminal.defaultShell
                                                : "__missing__"
                                        }
                                        onValueChange={handleDefaultShell}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={DEFAULT_TERMINAL_SHELL}>
                                                {getTerminalShellSummary(
                                                    shells,
                                                    systemShellPath,
                                                    DEFAULT_TERMINAL_SHELL,
                                                )}
                                            </SelectItem>
                                            {shells.map((shell) => (
                                                <SelectItem key={shell.path} value={shell.path}>
                                                    {getShellDisplayName(shell)}
                                                </SelectItem>
                                            ))}
                                            {!configuredShellAvailable && (
                                                <SelectItem value="__missing__" disabled>
                                                    {getTerminalShellSummary(
                                                        shells,
                                                        systemShellPath,
                                                        settings.terminal.defaultShell,
                                                    )}
                                                </SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <SettingRow
                                    label="Default Runtime"
                                    hint="Runtime for executing scripts and commands">
                                    <Select
                                        value={
                                            runtimes.some(
                                                (r) => r.name === settings.general.defaultRuntime,
                                            )
                                                ? settings.general.defaultRuntime
                                                : "__missing__"
                                        }
                                        onValueChange={handleDefaultRuntime}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {runtimes.length === 0 && (
                                                <SelectItem value="__none__" disabled>
                                                    No runtimes detected
                                                </SelectItem>
                                            )}
                                            {runtimes.map((rt) => (
                                                <SelectItem key={rt.name} value={rt.name}>
                                                    {rt.name} ({rt.version})
                                                </SelectItem>
                                            ))}
                                            {runtimes.length > 0 &&
                                                !runtimes.some(
                                                    (r) =>
                                                        r.name === settings.general.defaultRuntime,
                                                ) && (
                                                    <SelectItem value="__missing__" disabled>
                                                        {settings.general.defaultRuntime} (not
                                                        found)
                                                    </SelectItem>
                                                )}
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                            </>
                        )}

                        {section === "claude" && (
                            <>
                                <SettingRow
                                    label="Default Model"
                                    hint="Pre-selected model when running Claude sessions">
                                    <Select
                                        value={settings.claude.defaultModel}
                                        onValueChange={handleClaudeModel}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="default">Default</SelectItem>
                                            <SelectItem value="opus">Opus</SelectItem>
                                            <SelectItem value="sonnet">Sonnet</SelectItem>
                                            <SelectItem value="haiku">Haiku</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <SettingRow
                                    label="Full Access"
                                    hint="Skip permission prompts by default">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="claude-full-access"
                                            checked={settings.claude.fullAccess}
                                            onCheckedChange={handleClaudeFullAccess}
                                            disabled={settings.claude.dontAskQuestions}
                                        />
                                        <Label
                                            htmlFor="claude-full-access"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.claude.fullAccess ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="Don't Ask Questions"
                                    hint="Make agent fully autonomous (implies full access)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="claude-dont-ask"
                                            checked={settings.claude.dontAskQuestions}
                                            onCheckedChange={handleClaudeDontAsk}
                                        />
                                        <Label
                                            htmlFor="claude-dont-ask"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.claude.dontAskQuestions
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                            </>
                        )}

                        {section === "codex" && (
                            <>
                                <SettingRow
                                    label="Full Access"
                                    hint="Run in full-auto mode by default">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="codex-full-access"
                                            checked={settings.codex.fullAccess}
                                            onCheckedChange={handleCodexFullAccess}
                                            disabled={settings.codex.dontAskQuestions}
                                        />
                                        <Label
                                            htmlFor="codex-full-access"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.codex.fullAccess ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="Don't Ask Questions"
                                    hint="Make agent fully autonomous (implies full access)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="codex-dont-ask"
                                            checked={settings.codex.dontAskQuestions}
                                            onCheckedChange={handleCodexDontAsk}
                                        />
                                        <Label
                                            htmlFor="codex-dont-ask"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.codex.dontAskQuestions
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                            </>
                        )}

                        {section === "opencode" && (
                            <>
                                <SettingRow
                                    label="Default Model"
                                    hint="Pre-selected model (provider/model format)">
                                    <Input
                                        className="h-8 w-[180px] text-[13px]"
                                        placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                                        value={settings.opencode.defaultModel}
                                        onChange={handleOpencodeModel}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Full Access"
                                    hint="Auto-approve all tool permissions by default">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="opencode-full-access"
                                            checked={settings.opencode.fullAccess}
                                            onCheckedChange={handleOpencodeFullAccess}
                                            disabled={settings.opencode.dontAskQuestions}
                                        />
                                        <Label
                                            htmlFor="opencode-full-access"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.opencode.fullAccess ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="Don't Ask Questions"
                                    hint="Make agent fully autonomous (implies full access)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="opencode-dont-ask"
                                            checked={settings.opencode.dontAskQuestions}
                                            onCheckedChange={handleOpencodeDontAsk}
                                        />
                                        <Label
                                            htmlFor="opencode-dont-ask"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.opencode.dontAskQuestions
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                            </>
                        )}

                        {section === "gemini" && (
                            <>
                                <SettingRow
                                    label="Default Model"
                                    hint="Pre-selected model when running Gemini sessions">
                                    <Select
                                        value={settings.gemini.defaultModel}
                                        onValueChange={handleGeminiModel}>
                                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="default">Default</SelectItem>
                                            <SelectItem value="auto">Auto</SelectItem>
                                            <SelectItem value="pro">Pro</SelectItem>
                                            <SelectItem value="flash">Flash</SelectItem>
                                            <SelectItem value="flash-lite">Flash Lite</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </SettingRow>
                                <SettingRow
                                    label="Full Access"
                                    hint="Auto-approve all actions by default">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="gemini-full-access"
                                            checked={settings.gemini.fullAccess}
                                            onCheckedChange={handleGeminiFullAccess}
                                            disabled={settings.gemini.dontAskQuestions}
                                        />
                                        <Label
                                            htmlFor="gemini-full-access"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.gemini.fullAccess ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="Don't Ask Questions"
                                    hint="Make agent fully autonomous (implies full access)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="gemini-dont-ask"
                                            checked={settings.gemini.dontAskQuestions}
                                            onCheckedChange={handleGeminiDontAsk}
                                        />
                                        <Label
                                            htmlFor="gemini-dont-ask"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.gemini.dontAskQuestions
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                            </>
                        )}

                        {section === "cursor" && (
                            <>
                                <SettingRow
                                    label="Default Model"
                                    hint="Pre-selected model when running Cursor sessions">
                                    <Input
                                        className="h-8 w-[180px] text-[13px]"
                                        value={
                                            settings.cursor.defaultModel === "default"
                                                ? ""
                                                : settings.cursor.defaultModel
                                        }
                                        placeholder="default"
                                        onChange={(e) => handleCursorModel(e.target.value)}
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Full Access"
                                    hint="Run in yolo mode by default (auto-approve commands)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="cursor-full-access"
                                            checked={settings.cursor.fullAccess}
                                            onCheckedChange={handleCursorFullAccess}
                                            disabled={settings.cursor.dontAskQuestions}
                                        />
                                        <Label
                                            htmlFor="cursor-full-access"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.cursor.fullAccess ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="Don't Ask Questions"
                                    hint="Make agent fully autonomous (implies full access)">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="cursor-dont-ask"
                                            checked={settings.cursor.dontAskQuestions}
                                            onCheckedChange={handleCursorDontAsk}
                                        />
                                        <Label
                                            htmlFor="cursor-dont-ask"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.cursor.dontAskQuestions
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                            </>
                        )}

                        {section === "remote-agent" && (
                            <>
                                <SettingRow
                                    label="Auto Start"
                                    hint="Start remote agent when Taskflow launches">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="remote-auto-start"
                                            checked={settings.remoteAgent.autoStart}
                                            onCheckedChange={(autoStart: boolean) =>
                                                updateSettings({ remoteAgent: { autoStart } })
                                            }
                                        />
                                        <Label
                                            htmlFor="remote-auto-start"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.remoteAgent.autoStart
                                                ? "Enabled"
                                                : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <SettingRow
                                    label="App Name"
                                    hint="Display name for this instance on remote apps">
                                    <Input
                                        className="h-8 w-[180px] text-[13px]"
                                        placeholder="Auto-generated"
                                        value={settings.remoteAgent.appName}
                                        onChange={(e) =>
                                            updateSettings({
                                                remoteAgent: { appName: e.target.value },
                                            })
                                        }
                                    />
                                </SettingRow>
                                <SettingRow
                                    label="Headless"
                                    hint="Run without showing a session tab">
                                    <div className="flex items-center gap-2.5">
                                        <Switch
                                            id="remote-headless"
                                            checked={settings.remoteAgent.headless}
                                            onCheckedChange={(headless: boolean) =>
                                                updateSettings({ remoteAgent: { headless } })
                                            }
                                        />
                                        <Label
                                            htmlFor="remote-headless"
                                            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                            {settings.remoteAgent.headless ? "Enabled" : "Disabled"}
                                        </Label>
                                    </div>
                                </SettingRow>
                                <div className="hover:bg-island-base mx-1 flex items-center justify-between rounded-md px-5 py-3 transition-colors">
                                    <div className="min-w-0 flex-1 pr-6">
                                        <div className="text-secondary-foreground text-[13px] font-medium">
                                            Status
                                        </div>
                                        <div className="text-muted-foreground text-[11px] leading-snug">
                                            {remoteAgent.running
                                                ? "Remote agent is running"
                                                : "Remote agent is stopped"}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2.5">
                                        {remoteAgent.running && (
                                            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                                        )}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() =>
                                                void (remoteAgent.running
                                                    ? remoteAgent.stop()
                                                    : remoteAgent.start())
                                            }>
                                            {remoteAgent.running ? "Stop" : "Start"}
                                        </Button>
                                    </div>
                                </div>
                            </>
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

function SettingRow({
    label,
    hint,
    children,
}: {
    label: string;
    hint: string;
    children: React.ReactNode;
}) {
    return (
        <div className="hover:bg-island-base mx-1 flex items-start justify-between rounded-md px-5 py-3 transition-colors">
            <div className="min-w-0 flex-1 pr-6">
                <div className="text-secondary-foreground text-[13px] font-medium">{label}</div>
                <div className="text-muted-foreground text-[11px] leading-snug">{hint}</div>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

export { SettingsModal };
