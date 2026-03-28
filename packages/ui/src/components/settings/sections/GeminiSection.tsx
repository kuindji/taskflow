import { GeminiOptions } from "@/components/shared/GeminiOptions";

interface GeminiSectionProps {
    defaultModel: string;
    approvalMode: string;
    sandbox: boolean;
    onModelChange: (value: string) => void;
    onApprovalModeChange: (value: string) => void;
    onSandboxChange: (value: boolean) => void;
}

function GeminiSection({
    defaultModel,
    approvalMode,
    sandbox,
    onModelChange,
    onApprovalModeChange,
    onSandboxChange,
}: GeminiSectionProps) {
    return (
        <GeminiOptions
            mode="defaults"
            modelValue={defaultModel}
            approvalMode={approvalMode}
            sandbox={sandbox}
            onModelChange={onModelChange}
            onApprovalModeChange={onApprovalModeChange}
            onSandboxChange={onSandboxChange}
        />
    );
}

export { GeminiSection };
