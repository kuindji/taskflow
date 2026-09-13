import { KimiOptions } from "@/components/shared/KimiOptions";
import { useBackendStore } from "@/stores/backend-store";
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
    // Settings are primary's, so its Kimi CLI lists the models.
    const primaryId = useBackendStore((s) => s.primaryId);
    return (
        <KimiOptions
            mode="defaults"
            backendId={primaryId}
            modelValue={defaultModel}
            permissionMode={permissionMode}
            onModelChange={onModelChange}
            onPermissionModeChange={onPermissionModeChange}
        />
    );
}

export { KimiSection };
