import { useEffect, useState } from "react";
import { normalizePiThinkingLevel, type PiModelsResponse } from "@taskflow/shared";
import { loadPiModels } from "@/lib/agent-discovery";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PiModelSelect } from "@/components/settings/PiModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type { PiSettings, PiThinkingLevel } from "@taskflow/shared";
import { capitalize, launchDefaultLabel, type Inheritable } from "./launch-defaults";

interface PiOptionsProps {
    loadModels?: typeof loadPiModels;
    /** The machine the session runs on (settings: primary); lists its models. */
    backendId: string | null;
    modelValue: string;
    /** "default" (session mode only) leaves it unset for Settings to fill. */
    thinkingValue: Inheritable<PiThinkingLevel>;
    /** null (session mode only) leaves the tools unset for Settings to fill. */
    toolsValue: string | null;
    onModelChange: (value: string) => void;
    onThinkingChange: (value: Inheritable<PiThinkingLevel>) => void;
    onToolsChange: (value: string | null) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
    /** Session mode: the machine's Settings, which fill unset fields; null while loading. */
    settings?: PiSettings | null;
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Pi sessions",
        thinking: "Default Thinking",
        thinkingHint: "Default reasoning level for supported models",
        tools: "Default Tools",
        toolsHint: "Comma-separated list of built-in tools to enable",
    },
    session: {
        model: "Model",
        modelHint: "Model for Pi session (--model)",
        thinking: "Thinking",
        thinkingHint: "Reasoning level (--thinking)",
        tools: "Tools",
        toolsHint: "Comma-separated list of built-in tools (--tools)",
    },
};

const THINKING_OPTIONS: PiThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

function PiOptions(props: PiOptionsProps) {
    return <PiOptionsContent key={props.backendId} {...props} />;
}

function PiOptionsContent({
    loadModels,
    backendId,
    modelValue,
    thinkingValue,
    toolsValue,
    onModelChange,
    onThinkingChange,
    onToolsChange,
    mode = "session",
    headless = false,
    settings,
}: PiOptionsProps) {
    const l = LABELS[mode];
    const [inventory, setInventory] = useState<PiModelsResponse | null>(null);
    // Session fields left unset launch with the machine's Settings.
    const inheritsSettings = mode === "session" && !headless;
    const sessionDefault = (text: string | null | undefined) =>
        launchDefaultLabel("Pi", headless ? null : text);
    const key =
        modelValue || (inheritsSettings ? settings?.defaultModel : "") || inventory?.defaultModel;
    const supportsXhigh =
        inventory?.models.find((model) => `${model.provider}/${model.id}` === key)
            ?.supportsXhigh === true;
    // An unset level is the backend's to normalize, against the model it launches.
    const effectiveThinking =
        thinkingValue === "default"
            ? "default"
            : normalizePiThinkingLevel(thinkingValue, supportsXhigh);
    useEffect(() => {
        if (inventory !== null && effectiveThinking !== thinkingValue)
            onThinkingChange(effectiveThinking);
    }, [inventory, effectiveThinking, thinkingValue, onThinkingChange]);
    // Settings "off" and empty tools pass no flag, leaving the CLI's own default.
    const settingsThinkingText = !settings
        ? undefined
        : settings.thinking === "off"
          ? null
          : capitalize(settings.thinking);
    const toolsDefault = sessionDefault(settings ? settings.tools || null : undefined);

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <PiModelSelect
                    backendId={backendId}
                    value={modelValue}
                    onChange={onModelChange}
                    loadModels={loadModels}
                    onModelsChange={setInventory}
                    inheritedLabel={
                        inheritsSettings
                            ? sessionDefault(settings ? settings.defaultModel || null : undefined)
                            : undefined
                    }
                />
            </SettingRow>
            <SettingRow label={l.thinking} hint={l.thinkingHint}>
                <Select
                    value={effectiveThinking}
                    onValueChange={(v) =>
                        onThinkingChange(
                            v === "default"
                                ? "default"
                                : normalizePiThinkingLevel(v as PiThinkingLevel, supportsXhigh),
                        )
                    }>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {mode === "session" && (
                            <SelectItem value="default">
                                {sessionDefault(settingsThinkingText)}
                            </SelectItem>
                        )}
                        {THINKING_OPTIONS.filter((level) => level !== "xhigh" || supportsXhigh).map(
                            (level) => (
                                <SelectItem key={level} value={level}>
                                    {capitalize(level)}
                                </SelectItem>
                            ),
                        )}
                    </SelectContent>
                </Select>
            </SettingRow>
            {!headless && (
                <SettingRow label={l.tools} hint={l.toolsHint}>
                    <Input
                        size="sm"
                        className="text-[13px]"
                        placeholder={
                            inheritsSettings ? toolsDefault : "read,bash,edit,write,grep,find,ls"
                        }
                        value={toolsValue ?? ""}
                        // Clearing a session field hands it back to Settings.
                        onChange={(e) =>
                            onToolsChange(
                                inheritsSettings && e.target.value === "" ? null : e.target.value,
                            )
                        }
                    />
                </SettingRow>
            )}
        </>
    );
}

export { PiOptions };
