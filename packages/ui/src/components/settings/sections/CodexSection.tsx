import { CodexOptions } from "@/components/shared/CodexOptions";

interface CodexSectionProps {
    defaultModel: string;
    sandbox: string;
    approvalPolicy: string;
    fullAuto: boolean;
    onModelChange: (value: string) => void;
    onSandboxChange: (value: string) => void;
    onApprovalPolicyChange: (value: string) => void;
    onFullAutoChange: (value: boolean) => void;
}

function CodexSection({
    defaultModel,
    sandbox,
    approvalPolicy,
    fullAuto,
    onModelChange,
    onSandboxChange,
    onApprovalPolicyChange,
    onFullAutoChange,
}: CodexSectionProps) {
    return (
        <CodexOptions
            mode="defaults"
            modelValue={defaultModel}
            sandbox={sandbox}
            approvalPolicy={approvalPolicy}
            fullAuto={fullAuto}
            onModelChange={onModelChange}
            onSandboxChange={onSandboxChange}
            onApprovalPolicyChange={onApprovalPolicyChange}
            onFullAutoChange={onFullAutoChange}
        />
    );
}

export { CodexSection };
