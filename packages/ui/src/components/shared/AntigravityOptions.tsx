import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AntigravityModelSelect } from "@/components/settings/AntigravityModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type {
    AntigravityEffortLevel,
    AntigravityMode,
    AntigravitySettings,
} from "@taskflow/shared";
import { launchDefaultLabel, type Inheritable } from "./launch-defaults";

interface AntigravityOptionsProps {
    /** The machine the session runs on (settings: primary); lists its models. */
    backendId: string | null;
    modelValue: string;
    effortValue: Inheritable<AntigravityEffortLevel>;
    /** "default" (session mode only) leaves it unset for Settings to fill. */
    modeValue: Inheritable<AntigravityMode>;
    sandboxValue: Inheritable<boolean>;
    dangerouslySkipPermissionsValue: Inheritable<boolean>;
    onModelChange: (value: string) => void;
    onEffortChange: (value: Inheritable<AntigravityEffortLevel>) => void;
    onModeChange: (value: Inheritable<AntigravityMode>) => void;
    onSandboxChange: (value: Inheritable<boolean>) => void;
    onDangerouslySkipPermissionsChange: (value: Inheritable<boolean>) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
    /** Session mode: the machine's Settings, which fill unset fields; null while loading. */
    settings?: AntigravitySettings | null;
}

const EFFORT_OPTIONS: { value: AntigravityEffortLevel; label: string }[] = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "xhigh", label: "Extra High" },
    { value: "max", label: "Max" },
];

const MODE_OPTIONS: { value: AntigravityMode; label: string }[] = [
    { value: "manual", label: "Manual" },
    { value: "accept-edits", label: "Accept Edits" },
    { value: "auto", label: "Auto" },
    { value: "plan", label: "Plan" },
];

function booleanLabel(enabled: boolean): string {
    return enabled ? "Enabled" : "Disabled";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Antigravity sessions",
        effort: "Default Effort",
        effortHint: "Pre-selected reasoning effort for Antigravity sessions (--effort)",
        mode: "Default Mode",
        modeHint: "Execution mode for Antigravity sessions (--mode)",
        sandbox: "Terminal Sandbox",
        sandboxHint: "Run commands with terminal sandbox restrictions by default (--sandbox)",
        skipPermissions: "Skip Permissions",
        skipPermissionsHint:
            "Auto-approve all tool permission requests by default (--dangerously-skip-permissions)",
    },
    session: {
        model: "Model",
        modelHint: "Model for Antigravity session (--model)",
        effort: "Effort",
        effortHint: "Reasoning effort for Antigravity session (--effort)",
        mode: "Mode",
        modeHint: "Execution mode for this session (--mode)",
        sandbox: "Terminal Sandbox",
        sandboxHint: "Run commands with terminal sandbox restrictions (--sandbox)",
        skipPermissions: "Skip Permissions",
        skipPermissionsHint:
            "Auto-approve all tool permission requests (--dangerously-skip-permissions)",
    },
};

function AntigravityOptions({
    backendId,
    modelValue,
    effortValue,
    modeValue,
    sandboxValue,
    dangerouslySkipPermissionsValue,
    onModelChange,
    onEffortChange,
    onModeChange,
    onSandboxChange,
    onDangerouslySkipPermissionsChange,
    mode = "session",
    headless = false,
    settings,
}: AntigravityOptionsProps) {
    const l = LABELS[mode];
    const sandboxId = useId();
    const skipPermissionsId = useId();
    const inheritsSettings = mode === "session" && !headless;
    const sessionDefault = (text: string | null | undefined) =>
        launchDefaultLabel("Antigravity", headless ? null : text);

    const effortSettingText = settings
        ? settings.defaultEffort === "default"
            ? null
            : (EFFORT_OPTIONS.find((opt) => opt.value === settings.defaultEffort)?.label ??
              settings.defaultEffort)
        : undefined;
    const effortDefaultLabel = mode === "defaults" ? "Default" : sessionDefault(effortSettingText);

    const effectiveSandbox =
        sandboxValue === "default" ? (settings?.sandbox ?? false) : sandboxValue;
    const effectiveSkipPermissions =
        dangerouslySkipPermissionsValue === "default"
            ? (settings?.dangerouslySkipPermissions ?? false)
            : dangerouslySkipPermissionsValue;

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <AntigravityModelSelect
                    backendId={backendId}
                    value={modelValue}
                    onChange={onModelChange}
                    inheritedLabel={
                        inheritsSettings
                            ? sessionDefault(settings ? settings.defaultModel || null : undefined)
                            : undefined
                    }
                />
            </SettingRow>
            <SettingRow label={l.effort} hint={l.effortHint}>
                <Select
                    value={effortValue}
                    onValueChange={(v) => onEffortChange(v as Inheritable<AntigravityEffortLevel>)}>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">{effortDefaultLabel}</SelectItem>
                        {EFFORT_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
            {!headless && (
                <>
                    <SettingRow label={l.mode} hint={l.modeHint}>
                        <Select
                            value={modeValue}
                            onValueChange={(v) => onModeChange(v as Inheritable<AntigravityMode>)}>
                            <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {mode === "session" && (
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings
                                                ? (MODE_OPTIONS.find(
                                                      (opt) => opt.value === settings.mode,
                                                  )?.label ?? settings.mode)
                                                : undefined,
                                        )}
                                    </SelectItem>
                                )}
                                {MODE_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </SettingRow>
                    <SettingRow label={l.sandbox} hint={l.sandboxHint} className="h-8">
                        {inheritsSettings ? (
                            <Select
                                value={String(sandboxValue)}
                                onValueChange={(value) =>
                                    onSandboxChange(
                                        value === "default" ? "default" : value === "true",
                                    )
                                }>
                                <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings ? booleanLabel(settings.sandbox) : undefined,
                                        )}
                                    </SelectItem>
                                    <SelectItem value="true">{booleanLabel(true)}</SelectItem>
                                    <SelectItem value="false">{booleanLabel(false)}</SelectItem>
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="flex items-center gap-2.5">
                                <Switch
                                    id={sandboxId}
                                    checked={effectiveSandbox}
                                    onCheckedChange={onSandboxChange}
                                />
                                <Label
                                    htmlFor={sandboxId}
                                    className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                    {booleanLabel(effectiveSandbox)}
                                </Label>
                            </div>
                        )}
                    </SettingRow>
                    <SettingRow
                        label={l.skipPermissions}
                        hint={l.skipPermissionsHint}
                        className="h-8">
                        {inheritsSettings ? (
                            <Select
                                value={String(dangerouslySkipPermissionsValue)}
                                onValueChange={(value) =>
                                    onDangerouslySkipPermissionsChange(
                                        value === "default" ? "default" : value === "true",
                                    )
                                }>
                                <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings
                                                ? booleanLabel(settings.dangerouslySkipPermissions)
                                                : undefined,
                                        )}
                                    </SelectItem>
                                    <SelectItem value="true">{booleanLabel(true)}</SelectItem>
                                    <SelectItem value="false">{booleanLabel(false)}</SelectItem>
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="flex items-center gap-2.5">
                                <Switch
                                    id={skipPermissionsId}
                                    checked={effectiveSkipPermissions}
                                    onCheckedChange={onDangerouslySkipPermissionsChange}
                                />
                                <Label
                                    htmlFor={skipPermissionsId}
                                    className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                    {booleanLabel(effectiveSkipPermissions)}
                                </Label>
                            </div>
                        )}
                    </SettingRow>
                </>
            )}
        </>
    );
}

export { AntigravityOptions };
