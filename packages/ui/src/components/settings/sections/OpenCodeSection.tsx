import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";

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
    return (
        <OpenCodeOptions
            mode="defaults"
            modelValue={defaultModel}
            autoApprove={autoApprove}
            onModelChange={onModelChange}
            onAutoApproveChange={onAutoApproveChange}
        />
    );
}

export { OpenCodeSection };
