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

interface GeminiOptionsProps {
    modelValue: string;
    approvalMode: string;
    sandbox: boolean;
    onModelChange: (value: string) => void;
    onApprovalModeChange: (value: string) => void;
    onSandboxChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Gemini sessions",
        approvalMode: "Approval Mode",
        approvalModeHint: "Default approval mode for tool actions",
        sandbox: "Sandbox",
        sandboxHint: "Run in sandbox mode by default",
    },
    session: {
        model: "Model",
        modelHint: "Model for Gemini session",
        approvalMode: "Approval Mode",
        approvalModeHint: "Controls how tool actions are approved",
        sandbox: "Sandbox",
        sandboxHint: "Run in sandbox mode",
    },
};

function GeminiOptions({
    modelValue,
    approvalMode,
    sandbox,
    onModelChange,
    onApprovalModeChange,
    onSandboxChange,
    mode = "session",
}: GeminiOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <Input
                    className="h-8 w-[180px] text-[13px]"
                    placeholder="default"
                    value={modelValue}
                    onChange={(e) => onModelChange(e.target.value)}
                />
            </SettingRow>
            <SettingRow label={l.approvalMode} hint={l.approvalModeHint}>
                <Select value={approvalMode} onValueChange={onApprovalModeChange}>
                    <SelectTrigger className="h-8 w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="auto_edit">Auto Edit</SelectItem>
                        <SelectItem value="yolo">Yolo</SelectItem>
                        <SelectItem value="plan">Plan</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.sandbox} hint={l.sandboxHint}>
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="gemini-sandbox"
                        checked={sandbox}
                        onCheckedChange={onSandboxChange}
                    />
                    <Label
                        htmlFor="gemini-sandbox"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {sandbox ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
        </>
    );
}

export { GeminiOptions };
