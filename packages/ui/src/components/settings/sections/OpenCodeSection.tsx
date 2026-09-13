import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";
import { useBackendStore } from "@/stores/backend-store";

interface OpenCodeSectionProps {
    defaultModel: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
}

function OpenCodeSection({
    defaultModel,
    autoApprove,
    onModelChange,
    onAutoApproveChange,
}: OpenCodeSectionProps) {
    // Settings are primary's, so its OpenCode CLI lists the models.
    const primaryId = useBackendStore((s) => s.primaryId);
    return (
        <OpenCodeOptions
            mode="defaults"
            backendId={primaryId}
            modelValue={defaultModel}
            autoApprove={autoApprove}
            onModelChange={onModelChange}
            onAutoApproveChange={onAutoApproveChange}
        />
    );
}

export { OpenCodeSection };
