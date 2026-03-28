import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { SettingRow } from "./SettingRow";

interface ModelOption {
    value: string;
    label: string;
}

interface AgentSectionProps {
    agentKey: string;
    fullAccess: boolean;
    dontAskQuestions: boolean;
    onFullAccess: (value: boolean) => void;
    onDontAsk: (value: boolean) => void;
    modelValue?: string;
    modelOptions?: ModelOption[];
    modelInputPlaceholder?: string;
    onModelChange?: (value: string) => void;
    onModelInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    fullAccessHint?: string;
    effortValue?: string;
    effortOptions?: ModelOption[];
    onEffortChange?: (value: string) => void;
}

function AgentSection({
    agentKey,
    fullAccess,
    dontAskQuestions,
    onFullAccess,
    onDontAsk,
    modelValue,
    modelOptions,
    modelInputPlaceholder,
    onModelChange,
    onModelInputChange,
    fullAccessHint = "Skip permission prompts by default",
    effortValue,
    effortOptions,
    onEffortChange,
}: AgentSectionProps) {
    const hasSelectModel = modelOptions && onModelChange;
    const hasInputModel = onModelInputChange;
    const hasEffort = effortOptions && onEffortChange;

    return (
        <>
            {hasSelectModel && (
                <SettingRow
                    label="Default Model"
                    hint={`Pre-selected model when running ${agentKey} sessions`}>
                    <Select value={modelValue} onValueChange={onModelChange}>
                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {modelOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </SettingRow>
            )}
            {hasInputModel && (
                <SettingRow
                    label="Default Model"
                    hint={`Pre-selected model when running ${agentKey} sessions`}>
                    <Input
                        className="h-8 w-[180px] text-[13px]"
                        placeholder={modelInputPlaceholder ?? "default"}
                        value={modelValue}
                        onChange={onModelInputChange}
                    />
                </SettingRow>
            )}
            {hasEffort && (
                <SettingRow
                    label="Default Effort"
                    hint={`Pre-selected effort level when running ${agentKey} sessions`}>
                    <Select value={effortValue} onValueChange={onEffortChange}>
                        <SelectTrigger className="h-8 w-[180px] text-[13px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {effortOptions.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </SettingRow>
            )}
            <SettingRow label="Full Access" hint={fullAccessHint}>
                <div className="flex items-center gap-2.5">
                    <Switch
                        id={`${agentKey}-full-access`}
                        checked={fullAccess}
                        onCheckedChange={onFullAccess}
                        disabled={dontAskQuestions}
                    />
                    <Label
                        htmlFor={`${agentKey}-full-access`}
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {fullAccess ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow
                label="Don't Ask Questions"
                hint="Make agent fully autonomous (implies full access)">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id={`${agentKey}-dont-ask`}
                        checked={dontAskQuestions}
                        onCheckedChange={onDontAsk}
                    />
                    <Label
                        htmlFor={`${agentKey}-dont-ask`}
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {dontAskQuestions ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
        </>
    );
}

export { AgentSection };
