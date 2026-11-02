import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OpenCodeModelSelect } from "@/components/settings/OpenCodeModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { OpenCodeSettings } from "@taskflow/shared";
import { launchDefaultLabel, type Inheritable } from "./launch-defaults";

interface OpenCodeOptionsProps {
    /** The machine the session runs on (settings: primary); lists its models. */
    backendId: string | null;
    modelValue: string;
    /** "default" (session mode only) leaves it unset for Settings to fill. */
    autoApprove: Inheritable<boolean>;
    onModelChange: (value: string) => void;
    onAutoApproveChange: (value: Inheritable<boolean>) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
    /** Session mode: the machine's Settings, which fill unset fields; null while loading. */
    settings?: OpenCodeSettings | null;
}

function autoApproveLabel(enabled: boolean): string {
    return enabled ? "Enabled" : "Disabled";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running OpenCode sessions",
        autoApprove: "Auto-approve",
        autoApproveHint: "Auto-approve all tool permissions by default",
    },
    session: {
        model: "Model",
        modelHint: "Model for OpenCode session (--model)",
        autoApprove: "Auto-approve",
        autoApproveHint: "Auto-approve all tool permissions",
    },
};

function OpenCodeOptions({
    backendId,
    modelValue,
    autoApprove,
    onModelChange,
    onAutoApproveChange,
    mode = "session",
    headless = false,
    settings,
}: OpenCodeOptionsProps) {
    const l = LABELS[mode];
    const autoApproveId = useId();
    // Session fields left unset launch with the machine's Settings.
    const inheritsSettings = mode === "session" && !headless;
    const sessionDefault = (text: string | null | undefined) =>
        launchDefaultLabel("OpenCode", headless ? null : text);
    const effectiveAutoApprove =
        autoApprove === "default" ? (settings?.autoApprove ?? false) : autoApprove;

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <OpenCodeModelSelect
                    backendId={backendId}
                    value={modelValue}
                    onChange={onModelChange}
                    inheritedLabel={
                        mode === "session"
                            ? sessionDefault(settings ? settings.defaultModel || null : undefined)
                            : undefined
                    }
                />
            </SettingRow>
            {!headless && (
                <SettingRow label={l.autoApprove} hint={l.autoApproveHint} className="h-8">
                    {inheritsSettings ? (
                        <Select
                            value={String(autoApprove)}
                            onValueChange={(value) =>
                                onAutoApproveChange(
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
                                            ? autoApproveLabel(settings.autoApprove)
                                            : undefined,
                                    )}
                                </SelectItem>
                                <SelectItem value="true">{autoApproveLabel(true)}</SelectItem>
                                <SelectItem value="false">{autoApproveLabel(false)}</SelectItem>
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="flex items-center gap-2.5">
                            <Switch
                                id={autoApproveId}
                                checked={effectiveAutoApprove}
                                onCheckedChange={onAutoApproveChange}
                            />
                            <Label
                                htmlFor={autoApproveId}
                                className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                                {autoApproveLabel(effectiveAutoApprove)}
                            </Label>
                        </div>
                    )}
                </SettingRow>
            )}
        </>
    );
}

export { OpenCodeOptions };
