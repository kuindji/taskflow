import { KimiOptions } from "@/components/shared/KimiOptions";
import type { KimiPermissionMode } from "@taskflow/shared";

interface KimiSectionProps {
    defaultModel: string;
    permissionMode: KimiPermissionMode;
    onModelChange: (value: string) => void;
    onPermissionModeChange: (value: KimiPermissionMode) => void;
}

function KimiSection({
    defaultModel,
    permissionMode,
    onModelChange,
    onPermissionModeChange,
}: KimiSectionProps) {
    return (
        <KimiOptions
            mode="defaults"
            modelValue={defaultModel}
            permissionMode={permissionMode}
            onModelChange={onModelChange}
            onPermissionModeChange={onPermissionModeChange}
        />
    );
}

export { KimiSection };
