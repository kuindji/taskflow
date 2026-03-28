import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";

interface OpenCodeSectionProps {
    defaultModel: string;
    defaultVariant: string;
    autoApprove: boolean;
    onModelChange: (value: string) => void;
    onVariantChange: (value: string) => void;
    onAutoApproveChange: (value: boolean) => void;
}

function OpenCodeSection({
    defaultModel,
    defaultVariant,
    autoApprove,
    onModelChange,
    onVariantChange,
    onAutoApproveChange,
}: OpenCodeSectionProps) {
    return (
        <OpenCodeOptions
            mode="defaults"
            modelValue={defaultModel}
            variantValue={defaultVariant}
            autoApprove={autoApprove}
            onModelChange={onModelChange}
            onVariantChange={onVariantChange}
            onAutoApproveChange={onAutoApproveChange}
        />
    );
}

export { OpenCodeSection };
