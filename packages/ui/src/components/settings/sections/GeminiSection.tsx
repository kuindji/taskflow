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
import type { GeminiSettings } from "@taskflow/shared";

interface GeminiSectionProps {
    settings: GeminiSettings;
    onModelChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onApprovalModeChange: (value: string) => void;
    onSandboxChange: (value: boolean) => void;
}

function GeminiSection({
    settings,
    onModelChange,
    onApprovalModeChange,
    onSandboxChange,
}: GeminiSectionProps) {
    return (
        <>
            <SettingRow
                label="Default Model"
                hint="Pre-selected model when running Gemini sessions">
                <Input
                    className="h-8 w-[180px] text-[13px]"
                    placeholder="default"
                    value={settings.defaultModel}
                    onChange={onModelChange}
                />
            </SettingRow>
            <SettingRow
                label="Approval Mode"
                hint="Controls how tool actions are approved">
                <Select value={settings.approvalMode} onValueChange={onApprovalModeChange}>
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
            <SettingRow label="Sandbox" hint="Run in sandbox mode by default">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="gemini-sandbox"
                        checked={settings.sandbox}
                        onCheckedChange={onSandboxChange}
                    />
                    <Label
                        htmlFor="gemini-sandbox"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {settings.sandbox ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
        </>
    );
}

export { GeminiSection };
