import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CursorModelSelect } from "@/components/settings/CursorModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface CursorOptionsProps {
    modelValue: string;
    yolo: boolean;
    onModelChange: (value: string) => void;
    onYoloChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Cursor sessions",
        yolo: "Yolo",
        yoloHint: "Run in yolo mode by default (auto-approve commands)",
    },
    session: {
        model: "Model",
        modelHint: "Model for Cursor session",
        yolo: "Yolo",
        yoloHint: "Auto-approve commands (--yolo)",
    },
};

function CursorOptions({
    modelValue,
    yolo,
    onModelChange,
    onYoloChange,
    mode = "session",
}: CursorOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <div className="w-[180px]">
                    <CursorModelSelect value={modelValue} onChange={onModelChange} />
                </div>
            </SettingRow>
            <SettingRow label={l.yolo} hint={l.yoloHint}>
                <div className="flex items-center gap-2.5">
                    <Switch id="cursor-yolo" checked={yolo} onCheckedChange={onYoloChange} />
                    <Label
                        htmlFor="cursor-yolo"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {yolo ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
        </>
    );
}

export { CursorOptions };
