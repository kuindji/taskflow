import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface ClaudeOptionsProps {
    modelValue: string;
    effortValue: string;
    dangerouslySkipPermissions: boolean;
    permissionMode: string;
    onModelChange: (value: string) => void;
    onEffortChange: (value: string) => void;
    onSkipPermissions: (value: boolean) => void;
    onPermissionModeChange: (value: string) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Claude sessions",
        effort: "Default Effort",
        effortHint: "Pre-selected effort level when running Claude sessions",
        skipPermissions: "Skip Permissions",
        skipPermissionsHint:
            "Bypass all permission checks by default (--dangerously-skip-permissions)",
        permissionMode: "Permission Mode",
        permissionModeHint: "Default permission mode for Claude sessions",
    },
    session: {
        model: "Model",
        modelHint: "Model for Claude session",
        effort: "Effort",
        effortHint: "Effort level for Claude session",
        skipPermissions: "Skip Permissions",
        skipPermissionsHint: "Bypass all permission checks (--dangerously-skip-permissions)",
        permissionMode: "Permission Mode",
        permissionModeHint: "Permission mode for this session",
    },
};

function ClaudeOptions({
    modelValue,
    effortValue,
    dangerouslySkipPermissions,
    permissionMode,
    onModelChange,
    onEffortChange,
    onSkipPermissions,
    onPermissionModeChange,
    mode = "session",
}: ClaudeOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <Select value={modelValue} onValueChange={onModelChange}>
                    <SelectTrigger className="h-8 text-[13px]">
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
            <SettingRow label={l.effort} hint={l.effortHint}>
                <Select value={effortValue} onValueChange={onEffortChange}>
                    <SelectTrigger className="h-8 text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="max">Max</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.skipPermissions} hint={l.skipPermissionsHint}>
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="claude-skip-permissions"
                        checked={dangerouslySkipPermissions}
                        onCheckedChange={onSkipPermissions}
                    />
                    <Label
                        htmlFor="claude-skip-permissions"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {dangerouslySkipPermissions ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow label={l.permissionMode} hint={l.permissionModeHint}>
                <Select value={permissionMode} onValueChange={onPermissionModeChange}>
                    <SelectTrigger className="h-8 text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="acceptEdits">Accept Edits</SelectItem>
                        <SelectItem value="bypassPermissions">Bypass Permissions</SelectItem>
                        <SelectItem value="dontAsk">Don&apos;t Ask</SelectItem>
                        <SelectItem value="plan">Plan</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
        </>
    );
}

export { ClaudeOptions };
