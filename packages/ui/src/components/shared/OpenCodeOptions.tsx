import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { OpenCodeModelSelect } from "@/components/settings/OpenCodeModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface OpenCodeOptionsProps {
    modelValue: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
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
    modelValue,
    autoApprove,
    onModelChange,
    onAutoApproveChange,
    mode = "session",
}: OpenCodeOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <OpenCodeModelSelect value={modelValue} onChange={onModelChange} />
            </SettingRow>
            <SettingRow label={l.autoApprove} hint={l.autoApproveHint} className="h-8">
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
