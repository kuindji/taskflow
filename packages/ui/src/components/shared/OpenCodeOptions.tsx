import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { OpenCodeModelSelect } from "@/components/settings/OpenCodeModelSelect";
import { OpenCodeAgentSelect } from "@/components/settings/OpenCodeAgentSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface OpenCodeOptionsProps {
    modelValue: string;
    agentValue: string;
    variantValue: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onAgentChange: (value: string) => void;
    onVariantChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running OpenCode sessions",
        agent: "Default Agent",
        agentHint: "Which OpenCode agent to use by default",
        variant: "Default Variant",
        variantHint: "Model variant / reasoning effort level",
        autoApprove: "Auto-approve",
        autoApproveHint: "Auto-approve all tool permissions by default",
    },
    session: {
        model: "Model",
        modelHint: "Model for OpenCode session (--model)",
        agent: "Agent",
        agentHint: "Which OpenCode agent to use (--agent)",
        variant: "Variant",
        variantHint: "Reasoning effort level (--variant)",
        autoApprove: "Auto-approve",
        autoApproveHint: "Auto-approve all tool permissions",
    },
};

function OpenCodeOptions({
    modelValue,
    agentValue,
    variantValue,
    autoApprove,
    onModelChange,
    onAgentChange,
    onVariantChange,
    onAutoApproveChange,
    mode = "session",
}: OpenCodeOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <div className="w-[260px]">
                    <OpenCodeModelSelect value={modelValue} onChange={onModelChange} />
                </div>
            </SettingRow>
            <SettingRow label={l.agent} hint={l.agentHint}>
                <div className="w-[180px]">
                    <OpenCodeAgentSelect value={agentValue} onChange={onAgentChange} />
                </div>
            </SettingRow>
            <SettingRow label={l.variant} hint={l.variantHint}>
                <Select
                    value={variantValue || "none"}
                    onValueChange={(v) => onVariantChange(v === "none" ? "" : v)}>
                    <SelectTrigger className="h-8 w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="max">Max</SelectItem>
                        <SelectItem value="minimal">Minimal</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.autoApprove} hint={l.autoApproveHint}>
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="opencode-auto-approve"
                        checked={autoApprove}
                        onCheckedChange={onAutoApproveChange}
                    />
                    <Label
                        htmlFor="opencode-auto-approve"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {autoApprove ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
        </>
    );
}

export { OpenCodeOptions };
