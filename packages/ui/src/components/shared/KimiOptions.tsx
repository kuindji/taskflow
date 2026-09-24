import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { KimiModelSelect } from "@/components/settings/KimiModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type { KimiPermissionMode } from "@taskflow/shared";

interface KimiOptionsProps {
    /** The machine the session runs on (settings: primary); lists its models. */
    backendId: string | null;
    modelValue: string;
    permissionMode: KimiPermissionMode;
    onModelChange: (value: string) => void;
    onPermissionModeChange: (value: KimiPermissionMode) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Kimi sessions",
        permission: "Default Permission Mode",
        permissionHint:
            "Manual approves in the TUI; Auto (--auto) and Yolo (--yolo) skip approvals",
    },
    session: {
        model: "Model",
        modelHint: "Model for Kimi session (--model)",
        permission: "Permission Mode",
        permissionHint:
            "Manual approves in the TUI; Auto (--auto) and Yolo (--yolo) skip approvals",
    },
};

const PERMISSION_OPTIONS: { value: KimiPermissionMode; label: string }[] = [
    { value: "manual", label: "Manual" },
    { value: "auto", label: "Auto (--auto)" },
    { value: "yolo", label: "Yolo (--yolo)" },
];

function KimiOptions({
    backendId,
    modelValue,
    permissionMode,
    onModelChange,
    onPermissionModeChange,
    mode = "session",
    headless = false,
}: KimiOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <KimiModelSelect
                    backendId={backendId}
                    value={modelValue}
                    onChange={onModelChange}
                />
            </SettingRow>
            {!headless && (
                <SettingRow label={l.permission} hint={l.permissionHint}>
                    <Select
                        value={permissionMode}
                        onValueChange={(v) => onPermissionModeChange(v as KimiPermissionMode)}>
                        <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PERMISSION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </SettingRow>
            )}
        </>
    );
}

export { KimiOptions };
