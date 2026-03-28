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

interface CodexSectionProps {
    defaultModel: string;
    sandbox: string;
    approvalPolicy: string;
    fullAuto: boolean;
    onModelChange: (value: string) => void;
    onSandboxChange: (value: string) => void;
    onApprovalPolicyChange: (value: string) => void;
    onFullAutoChange: (value: boolean) => void;
}

function CodexSection({
    defaultModel,
    sandbox,
    approvalPolicy,
    fullAuto,
    onModelChange,
    onSandboxChange,
    onApprovalPolicyChange,
    onFullAutoChange,
}: CodexSectionProps) {
    return (
        <>
            <SettingRow label="Default Model" hint="Pre-selected model when running Codex sessions">
                <Input
                    className="h-8 w-[180px] text-[13px]"
                    placeholder="e.g. o3, o4-mini"
                    value={defaultModel}
                    onChange={(e) => onModelChange(e.target.value)}
                />
            </SettingRow>
            <SettingRow
                label="Full Auto"
                hint="Convenience mode: workspace-write sandbox + on-request approval">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="codex-full-auto"
                        checked={fullAuto}
                        onCheckedChange={onFullAutoChange}
                    />
                    <Label
                        htmlFor="codex-full-auto"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {fullAuto ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow label="Sandbox" hint="Sandbox policy for model-generated shell commands">
                <Select value={sandbox} onValueChange={onSandboxChange} disabled={fullAuto}>
                    <SelectTrigger className="h-8 w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="read-only">Read only</SelectItem>
                        <SelectItem value="workspace-write">Workspace write</SelectItem>
                        <SelectItem value="danger-full-access">Full access (dangerous)</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label="Approval Policy" hint="When to ask for user approval of commands">
                <Select
                    value={approvalPolicy}
                    onValueChange={onApprovalPolicyChange}
                    disabled={fullAuto}>
                    <SelectTrigger className="h-8 w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="always">Always</SelectItem>
                        <SelectItem value="unless-allow-listed">Unless allow-listed</SelectItem>
                        <SelectItem value="on-request">On request</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
        </>
    );
}

export { CodexSection };
