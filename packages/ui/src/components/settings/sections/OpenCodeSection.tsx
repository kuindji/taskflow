import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";

interface OpenCodeSectionProps {
    defaultModel: string;
    defaultAgent: string;
    defaultVariant: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onAgentChange: (value: string) => void;
    onVariantChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
}

function OpenCodeSection({
    defaultModel,
    defaultAgent,
    defaultVariant,
    autoApprove,
    onModelChange,
    onAgentChange,
    onVariantChange,
    onAutoApproveChange,
}: OpenCodeSectionProps) {
    return (
        <OpenCodeOptions
            mode="defaults"
            modelValue={defaultModel}
            agentValue={defaultAgent}
            variantValue={defaultVariant}
            autoApprove={autoApprove}
            onModelChange={onModelChange}
            onAgentChange={onAgentChange}
            onVariantChange={onVariantChange}
            onAutoApproveChange={onAutoApproveChange}
        />
    );
}

export { OpenCodeSection };
