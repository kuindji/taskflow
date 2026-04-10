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
import type { PiThinkingLevel } from "@taskflow/shared";

interface PiOptionsProps {
    modelValue: string;
    thinkingValue: PiThinkingLevel;
    toolsValue: string;
    onModelChange: (value: string) => void;
    onThinkingChange: (value: PiThinkingLevel) => void;
    onToolsChange: (value: string) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
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

const THINKING_OPTIONS: PiThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];

function PiOptions({
    modelValue,
    thinkingValue,
    toolsValue,
    onModelChange,
    onThinkingChange,
    onToolsChange,
    mode = "session",
}: PiOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <PiModelSelect value={modelValue} onChange={onModelChange} />
            </SettingRow>
            <SettingRow label={l.thinking} hint={l.thinkingHint}>
                <Select
                    value={thinkingValue}
                    onValueChange={(v) => onThinkingChange(v as PiThinkingLevel)}>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {THINKING_OPTIONS.map((level) => (
                            <SelectItem key={level} value={level}>
                                {level === "off" ? "Off" : level.charAt(0).toUpperCase() + level.slice(1)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.tools} hint={l.toolsHint}>
                <Input
                    size="sm"
                    className="text-[13px]"
                    placeholder="read,bash,edit,write,grep,find,ls"
                    value={toolsValue}
                    onChange={(e) => onToolsChange(e.target.value)}
                />
            </SettingRow>
        </>
    );
}

export { PiOptions };
