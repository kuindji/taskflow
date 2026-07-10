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
    permissionMode: string;
    supportsUltracode?: boolean;
    onModelChange: (value: string) => void;
    onEffortChange: (value: string) => void;
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
        permissionMode: "Permission Mode",
        permissionModeHint: "Default permission mode for Claude sessions",
    },
    session: {
        model: "Model",
        modelHint: "Model for Claude session",
        effort: "Effort",
        effortHint: "Effort level for Claude session",
        permissionMode: "Permission Mode",
        permissionModeHint: "Permission mode for this session",
    },
};

function ClaudeOptions({
    modelValue,
    effortValue,
    permissionMode,
    supportsUltracode = true,
    onModelChange,
    onEffortChange,
    onPermissionModeChange,
    mode = "session",
}: ClaudeOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <Select value={modelValue} onValueChange={onModelChange}>
                    <SelectTrigger size="sm" className="text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="fable">Fable</SelectItem>
                        <SelectItem value="opus">Opus</SelectItem>
                        <SelectItem value="sonnet">Sonnet</SelectItem>
                        <SelectItem value="haiku">Haiku</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.effort} hint={l.effortHint}>
                <Select value={effortValue} onValueChange={onEffortChange}>
                    <SelectTrigger size="sm" className="text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="xhigh">Extra High</SelectItem>
                        <SelectItem value="max">Max</SelectItem>
                        <SelectItem value="ultracode" disabled={!supportsUltracode}>
                            Ultracode{supportsUltracode ? "" : " (requires Claude 2.1.203+)"}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.permissionMode} hint={l.permissionModeHint}>
                <Select value={permissionMode} onValueChange={onPermissionModeChange}>
                    <SelectTrigger size="sm" className="text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Inherit Claude Default</SelectItem>
                        <SelectItem value="manual">Manual</SelectItem>
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
