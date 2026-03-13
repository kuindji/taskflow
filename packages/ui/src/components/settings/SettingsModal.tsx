import { useCallback, useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
    type ShellInfo,
    type ShellListResponse,
    type RuntimeInfo,
    type RuntimeListResponse,
    type ClaudeSettings,
} from "@taskflow/shared";
import { FontFamilySelect } from "./FontFamilySelect";

const EDITOR_OPTIONS = [
    { value: "system", label: "System Default" },
    { value: "vscode", label: "VS Code" },
    { value: "cursor", label: "Cursor" },
    { value: "windsurf", label: "Windsurf" },
    { value: "zed", label: "Zed" },
    { value: "sublime", label: "Sublime Text" },
    { value: "webstorm", label: "WebStorm" },
    { value: "idea", label: "IntelliJ IDEA" },
    { value: "emacs", label: "Emacs" },
] as const;

function SettingsModal() {
    const open = useUIStore((s) => s.settingsOpen);
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const settings = useSettingsStore((s) => s.settings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const [shells, setShells] = useState<ShellInfo[]>([]);
    const [systemShellPath, setSystemShellPath] = useState<string | null>(null);
    const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);
    const [section, setSection] = useState<"fonts" | "defaults" | "claude" | "codex">("fonts");

    useEffect(() => {
        if (!open) return;

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
    }, [open]);

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleSettings();
        },
        [toggleSettings],
    );

    const handleGeneralFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ general: { fontFamily } });
        },
        [updateSettings],
    );

    const handleGeneralFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ general: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleTerminalFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ terminal: { fontFamily } });
        },
        [updateSettings],
    );

    const handleTerminalFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ terminal: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleDefaultShell = useCallback(
        (defaultShell: string) => {
            void updateSettings({ terminal: { defaultShell } });
        },
        [updateSettings],
    );

    const handleEditorFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ editor: { fontFamily } });
        },
        [updateSettings],
    );

    const handleEditorFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ editor: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleExternalEditor = useCallback(
        (externalEditor: string) => {
            void updateSettings({ general: { externalEditor } });
        },
        [updateSettings],
    );

    const handleDefaultAgent = useCallback(
        (value: string) => {
            if (value === "claude" || value === "codex") {
                void updateSettings({ general: { defaultAgent: value } });
            }
        },
        [updateSettings],
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

    const handleCodexFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ codex: { fullAccess } });
        },
        [updateSettings],
    );

    if (!settings) return null;

    const configuredShellAvailable = isConfiguredShellAvailable(
        shells,
        settings.terminal.defaultShell,
    );
    const defaultsSelectLabelClassName = "text-xxs/none text-muted-foreground";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>Changes apply immediately.</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-[360px]">
                    {/* Sidebar */}
                    <nav className="border-border w-40 shrink-0 space-y-1 border-r pr-2">
                        <button
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                                section === "fonts"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                            onClick={() => setSection("fonts")}
                        >
                            Fonts
                        </button>
                        <button
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                                section === "defaults"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                            onClick={() => setSection("defaults")}
                        >
                            Defaults
                        </button>
                        <button
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                                section === "claude"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                            onClick={() => setSection("claude")}
                        >
                            Claude
                        </button>
                        <button
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                                section === "codex"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                            onClick={() => setSection("codex")}
                        >
                            Codex
                        </button>
                    </nav>

                    {/* Content */}
                    <div className="flex-1 space-y-6 pl-6">
                        {section === "fonts" && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Application Font</h3>
                                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                                        <div className="min-w-0 space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Family
                                            </Label>
                                            <FontFamilySelect
                                                value={settings.general.fontFamily}
                                                onChange={handleGeneralFontFamily}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Size
                                            </Label>
                                            <Input
                                                type="number"
                                                min={8}
                                                max={32}
                                                value={settings.general.fontSize}
                                                onChange={handleGeneralFontSize}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Terminal Font</h3>
                                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                                        <div className="min-w-0 space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Family
                                            </Label>
                                            <FontFamilySelect
                                                value={settings.terminal.fontFamily}
                                                onChange={handleTerminalFontFamily}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Size
                                            </Label>
                                            <Input
                                                type="number"
                                                min={8}
                                                max={32}
                                                value={settings.terminal.fontSize}
                                                onChange={handleTerminalFontSize}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Editor Font</h3>
                                    <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                                        <div className="min-w-0 space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Family
                                            </Label>
                                            <FontFamilySelect
                                                value={settings.editor.fontFamily}
                                                onChange={handleEditorFontFamily}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className={defaultsSelectLabelClassName}>
                                                Size
                                            </Label>
                                            <Input
                                                type="number"
                                                min={8}
                                                max={32}
                                                value={settings.editor.fontSize}
                                                onChange={handleEditorFontSize}
                                                className="h-8 text-sm"
                                            />
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}
                        {section === "claude" && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Default Model</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Pre-selected model when running Claude sessions
                                        </Label>
                                        <Select
                                            value={settings.claude.defaultModel}
                                            onValueChange={handleClaudeModel}
                                        >
                                            <SelectTrigger className="h-8 w-64 text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="default">Default</SelectItem>
                                                <SelectItem value="opus">Opus</SelectItem>
                                                <SelectItem value="sonnet">Sonnet</SelectItem>
                                                <SelectItem value="haiku">Haiku</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Full Access</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Skip permission prompts by default
                                        </Label>
                                        <div className="flex items-center gap-2 pt-1">
                                            <Switch
                                                id="claude-full-access"
                                                checked={settings.claude.fullAccess}
                                                onCheckedChange={handleClaudeFullAccess}
                                            />
                                            <Label
                                                htmlFor="claude-full-access"
                                                className="cursor-pointer text-sm"
                                            >
                                                {settings.claude.fullAccess
                                                    ? "Enabled"
                                                    : "Disabled"}
                                            </Label>
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}
                        {section === "codex" && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Full Access</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Run in full-auto mode by default
                                        </Label>
                                        <div className="flex items-center gap-2 pt-1">
                                            <Switch
                                                id="codex-full-access"
                                                checked={settings.codex.fullAccess}
                                                onCheckedChange={handleCodexFullAccess}
                                            />
                                            <Label
                                                htmlFor="codex-full-access"
                                                className="cursor-pointer text-sm"
                                            >
                                                {settings.codex.fullAccess ? "Enabled" : "Disabled"}
                                            </Label>
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}
                        {section === "defaults" && (
                            <>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">External Editor</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Used when opening files with Cmd+Click in the terminal
                                        </Label>
                                        <Select
                                            value={settings.general.externalEditor}
                                            onValueChange={handleExternalEditor}
                                        >
                                            <SelectTrigger className="h-8 w-full text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {EDITOR_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Default Agent</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Pre-selected agent for new tasks, title generation, and
                                            commit messages
                                        </Label>
                                        <Select
                                            value={settings.general.defaultAgent}
                                            onValueChange={handleDefaultAgent}
                                        >
                                            <SelectTrigger className="h-8 w-full text-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="claude">Claude</SelectItem>
                                                <SelectItem value="codex">Codex</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Default Shell</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Default shell for new terminal tabs
                                        </Label>
                                        <Select
                                            value={
                                                configuredShellAvailable
                                                    ? settings.terminal.defaultShell
                                                    : "__missing__"
                                            }
                                            onValueChange={handleDefaultShell}
                                        >
                                            <SelectTrigger className="h-8 w-full text-sm">
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
                                    </div>
                                </section>
                                <section className="space-y-3">
                                    <h3 className="text-sm font-medium">Default Runtime</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Runtime for executing scripts and commands
                                        </Label>
                                        <Select
                                            value={
                                                runtimes.some(
                                                    (r) =>
                                                        r.name === settings.general.defaultRuntime,
                                                )
                                                    ? settings.general.defaultRuntime
                                                    : "__missing__"
                                            }
                                            onValueChange={handleDefaultRuntime}
                                        >
                                            <SelectTrigger className="h-8 w-full text-sm">
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
                                                            r.name ===
                                                            settings.general.defaultRuntime,
                                                    ) && (
                                                        <SelectItem value="__missing__" disabled>
                                                            {settings.general.defaultRuntime} (not
                                                            found)
                                                        </SelectItem>
                                                    )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </section>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { SettingsModal };
