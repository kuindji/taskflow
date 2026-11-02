import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type { ClaudeSettings } from "@taskflow/shared";
import { capitalize, launchDefaultLabel } from "./launch-defaults";

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
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
    /** Session mode: the machine's Settings, which fill the "Default" choices; null while loading. */
    settings?: ClaudeSettings | null;
}

const EFFORT_LABELS: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
    ultracode: "Ultracode",
};

const PERMISSION_LABELS: Record<string, string> = {
    manual: "Manual",
    auto: "Auto",
    acceptEdits: "Accept Edits",
    bypassPermissions: "Bypass Permissions",
    dontAsk: "Don't Ask",
    plan: "Plan",
};

/** A Settings value as text; null when Settings leaves it to the CLI ("default"). */
function settingText(
    value: string | undefined,
    labels?: Record<string, string>,
): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === "default" || value === "") return null;
    return labels?.[value] ?? capitalize(value);
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
    headless = false,
    settings,
}: ClaudeOptionsProps) {
    const l = LABELS[mode];
    // Session "Default" leaves the field unset: the machine's Settings fill it,
    // except headless runs, where the CLI decides.
    const sessionDefault = (value: string | undefined, labels?: Record<string, string>) =>
        launchDefaultLabel("Claude", headless ? null : settingText(value, labels));
    const modelDefault = mode === "defaults" ? "Default" : sessionDefault(settings?.defaultModel);
    const effortDefault =
        mode === "defaults" ? "Default" : sessionDefault(settings?.defaultEffort, EFFORT_LABELS);
    const permissionDefault =
        mode === "defaults"
            ? "Inherit Claude Default"
            : sessionDefault(settings?.permissionMode, PERMISSION_LABELS);

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <Select value={modelValue} onValueChange={onModelChange}>
                    <SelectTrigger size="sm" className="text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">{modelDefault}</SelectItem>
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
                        <SelectItem value="default">{effortDefault}</SelectItem>
                        {Object.entries(EFFORT_LABELS).map(([value, label]) =>
                            value === "ultracode" ? (
                                <SelectItem key={value} value={value} disabled={!supportsUltracode}>
                                    {label}
                                    {supportsUltracode ? "" : " (requires Claude 2.1.203+)"}
                                </SelectItem>
                            ) : (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ),
                        )}
                    </SelectContent>
                </Select>
            </SettingRow>
            {!headless && (
                <SettingRow label={l.permissionMode} hint={l.permissionModeHint}>
                    <Select value={permissionMode} onValueChange={onPermissionModeChange}>
                        <SelectTrigger size="sm" className="text-[13px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">{permissionDefault}</SelectItem>
                            {Object.entries(PERMISSION_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </SettingRow>
            )}
        </>
    );
}

export { ClaudeOptions };
