import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CursorModelSelect } from "@/components/settings/CursorModelSelect";
import { SettingRow } from "./SettingRow";

interface CursorSectionProps {
    yolo: boolean;
    modelValue: string;
    onYolo: (value: boolean) => void;
    onModelChange: (model: string) => void;
}

function CursorSection({ yolo, modelValue, onYolo, onModelChange }: CursorSectionProps) {
    return (
        <>
            <SettingRow
                label="Default Model"
                hint="Pre-selected model when running cursor sessions">
                <div className="w-[180px]">
                    <CursorModelSelect value={modelValue} onChange={onModelChange} />
                </div>
            </SettingRow>
            <SettingRow label="Yolo" hint="Run in yolo mode by default (auto-approve commands)">
                <div className="flex items-center gap-2.5">
                    <Switch id="cursor-yolo" checked={yolo} onCheckedChange={onYolo} />
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

export { CursorSection };
