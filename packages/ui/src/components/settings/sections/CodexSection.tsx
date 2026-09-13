import { CodexOptions } from "@/components/shared/CodexOptions";
import { useBackendStore } from "@/stores/backend-store";
import type { CodexApprovalPolicy, CodexReasoningEffort, CodexSandboxMode } from "@taskflow/shared";

interface CodexSectionProps {
    defaultModel: string;
    defaultReasoningEffort: CodexReasoningEffort | "default";
    sandbox: CodexSandboxMode;
    approvalPolicy: CodexApprovalPolicy;
    dangerouslyBypassApprovalsAndSandbox: boolean;
    onModelChange: (value: string) => void;
    onReasoningEffortChange: (value: CodexReasoningEffort | "default") => void;
    onSandboxChange: (value: CodexSandboxMode) => void;
    onApprovalPolicyChange: (value: CodexApprovalPolicy) => void;
    onDangerouslyBypassApprovalsAndSandboxChange: (value: boolean) => void;
}

function CodexSection({
    defaultModel,
    defaultReasoningEffort,
    sandbox,
    approvalPolicy,
    dangerouslyBypassApprovalsAndSandbox,
    onModelChange,
    onReasoningEffortChange,
    onSandboxChange,
    onApprovalPolicyChange,
    onDangerouslyBypassApprovalsAndSandboxChange,
}: CodexSectionProps) {
    // Settings are primary's, so its Codex CLI lists the models.
    const primaryId = useBackendStore((s) => s.primaryId);
    return (
        <CodexOptions
            mode="defaults"
            backendId={primaryId}
            modelValue={defaultModel}
            reasoningEffort={defaultReasoningEffort}
            sandbox={sandbox}
            approvalPolicy={approvalPolicy}
            dangerouslyBypassApprovalsAndSandbox={dangerouslyBypassApprovalsAndSandbox}
            onModelChange={onModelChange}
            onReasoningEffortChange={onReasoningEffortChange}
            onSandboxChange={onSandboxChange}
            onApprovalPolicyChange={onApprovalPolicyChange}
            onDangerouslyBypassApprovalsAndSandboxChange={
                onDangerouslyBypassApprovalsAndSandboxChange
            }
        />
    );
}

export { CodexSection };
