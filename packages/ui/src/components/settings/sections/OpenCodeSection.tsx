import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useOpenCodeModels, useOpenCodeAgents } from "@/hooks/useOpenCodeData";
import { SettingRow } from "./SettingRow";

interface OpenCodeSectionProps {
    modelValue: string;
    agentValue: string;
    variantValue: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onAgentChange: (value: string) => void;
    onVariantChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
}

function OpenCodeSection({
    modelValue,
    agentValue,
    variantValue,
    autoApprove,
    onModelChange,
    onAgentChange,
    onVariantChange,
    onAutoApproveChange,
}: OpenCodeSectionProps) {
    const ocModels = useOpenCodeModels();
    const ocAgents = useOpenCodeAgents();

    const modelOptions = useMemo(() => {
        if (!ocModels) return null;
        return ocModels.map((m) => ({ value: m.id, label: m.id }));
    }, [ocModels]);

    const agentOptions = useMemo(() => {
        if (!ocAgents) return null;
        return ocAgents.map((a) => ({ value: a.name, label: `${a.name} (${a.kind})` }));
    }, [ocAgents]);

    return (
        <>
            <SettingRow
                label="Default Model"
                hint="Pre-selected model when running OpenCode sessions">
                <SearchableSelect
                    value={modelValue}
                    onChange={onModelChange}
                    options={modelOptions}
                    placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                    allowCustom
                    className="w-[260px]"
                />
            </SettingRow>
            <SettingRow
                label="Default Agent"
                hint="Which OpenCode agent to use by default">
                <SearchableSelect
                    value={agentValue}
                    onChange={onAgentChange}
                    options={agentOptions}
                    placeholder="Default agent"
                    allowCustom
                    className="w-[180px]"
                />
            </SettingRow>
            <SettingRow
                label="Default Variant"
                hint="Model variant / reasoning effort level">
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
            <SettingRow
                label="Auto-approve"
                hint="Auto-approve all tool permissions by default">
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

export { OpenCodeSection };
