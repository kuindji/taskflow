import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    getShellDisplayName,
    getTerminalShellSummary,
    isConfiguredShellAvailable,
} from "@/lib/terminal-shells";
import {
    DEFAULT_TERMINAL_SHELL,
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    type AgentType,
    type ShellInfo,
    type RuntimeInfo,
    type EditorInfo,
    type AppSettings,
    type AgentAvailability,
} from "@taskflow/shared";
import { isAgentAvailable } from "@/hooks/useAgentAvailability";
import { SettingRow } from "./SettingRow";

interface DefaultsSectionProps {
    settings: AppSettings;
    shells: ShellInfo[];
    systemShellPath: string | null;
    runtimes: RuntimeInfo[];
    systemEditors: EditorInfo[];
    agents: AgentAvailability[];
    onInternalEditor: (value: string) => void;
    onExternalEditor: (value: string) => void;
    onDefaultAgent: (value: string) => void;
    onToggleFavoriteAgent: (agent: AgentType, checked: boolean) => void;
    onDefaultShell: (value: string) => void;
    onDefaultRuntime: (value: string) => void;
}

function DefaultsSection({
    settings,
    shells,
    systemShellPath,
    runtimes,
    systemEditors,
    agents,
    onInternalEditor,
    onExternalEditor,
    onDefaultAgent,
    onToggleFavoriteAgent,
    onDefaultShell,
    onDefaultRuntime,
}: DefaultsSectionProps) {
    const configuredShellAvailable = isConfiguredShellAvailable(
        shells,
        settings.terminal.defaultShell,
    );

    return (
        <>
            <SettingRow
                label="Internal Editor"
                hint="Opens files when clicking paths in the terminal">
                <Select value={settings.editor.internalEditor} onValueChange={onInternalEditor}>
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
                <Select value={settings.editor.externalEditor} onValueChange={onExternalEditor}>
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
                <Select value={settings.general.defaultAgent} onValueChange={onDefaultAgent}>
                    <SelectTrigger className="h-8 w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ALL_AGENT_TYPES.map((agent) => {
                            const available = isAgentAvailable(agents, agent);
                            return (
                                <SelectItem key={agent} value={agent} disabled={!available}>
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
                        Favorited agents appear as buttons in the workspace toolbar
                    </div>
                </div>
                {ALL_AGENT_TYPES.filter((agent) => isAgentAvailable(agents, agent)).map((agent) => (
                    <div key={agent} className="flex items-center justify-between py-0.5">
                        <Label
                            htmlFor={`toolbar-agent-${agent}`}
                            className="text-secondary-foreground cursor-pointer text-[13px] font-normal normal-case">
                            {AGENT_DISPLAY_NAMES[agent]}
                        </Label>
                        <Switch
                            id={`toolbar-agent-${agent}`}
                            checked={(settings.general.favoriteAgents ?? ALL_AGENT_TYPES).includes(
                                agent,
                            )}
                            onCheckedChange={(checked) => onToggleFavoriteAgent(agent, checked)}
                        />
                    </div>
                ))}
            </div>
            <SettingRow label="Default Shell" hint="Default shell for new terminal tabs">
                <Select
                    value={
                        configuredShellAvailable ? settings.terminal.defaultShell : "__missing__"
                    }
                    onValueChange={onDefaultShell}>
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
            <SettingRow label="Default Runtime" hint="Runtime for executing scripts and commands">
                <Select
                    value={
                        runtimes.some((r) => r.name === settings.general.defaultRuntime)
                            ? settings.general.defaultRuntime
                            : "__missing__"
                    }
                    onValueChange={onDefaultRuntime}>
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
                            !runtimes.some((r) => r.name === settings.general.defaultRuntime) && (
                                <SelectItem value="__missing__" disabled>
                                    {settings.general.defaultRuntime} (not found)
                                </SelectItem>
                            )}
                    </SelectContent>
                </Select>
            </SettingRow>
        </>
    );
}

export { DefaultsSection };
