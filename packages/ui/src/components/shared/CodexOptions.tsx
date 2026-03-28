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
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface CodexOptionsProps {
    modelValue: string;
    sandbox: string;
    approvalPolicy: string;
    fullAuto: boolean;
    onModelChange: (value: string) => void;
    onSandboxChange: (value: string) => void;
    onApprovalPolicyChange: (value: string) => void;
    onFullAutoChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Codex sessions",
        fullAuto: "Full Auto",
        fullAutoHint: "Convenience mode: workspace-write sandbox + on-request approval",
        sandbox: "Sandbox",
        sandboxHint: "Default sandbox policy for model-generated shell commands",
        approvalPolicy: "Approval Policy",
        approvalPolicyHint: "Default approval policy for commands",
    },
    session: {
        model: "Model",
        modelHint: "Model for Codex session",
        fullAuto: "Full Auto",
        fullAutoHint: "Convenience mode: workspace-write sandbox + on-request approval",
        sandbox: "Sandbox",
        sandboxHint: "Sandbox policy for model-generated shell commands",
        approvalPolicy: "Approval Policy",
        approvalPolicyHint: "When to ask for approval of commands",
    },
};

function CodexOptions({
    modelValue,
    sandbox,
    approvalPolicy,
    fullAuto,
    onModelChange,
    onSandboxChange,
    onApprovalPolicyChange,
    onFullAutoChange,
    mode = "session",
}: CodexOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <Input
                    className="h-8 w-[180px] text-[13px]"
                    placeholder="e.g. o3, o4-mini"
                    value={modelValue}
                    onChange={(e) => onModelChange(e.target.value)}
                />
            </SettingRow>
            <SettingRow label={l.fullAuto} hint={l.fullAutoHint}>
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
            <SettingRow label={l.sandbox} hint={l.sandboxHint}>
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
            <SettingRow label={l.approvalPolicy} hint={l.approvalPolicyHint}>
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

export { CodexOptions };
