import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
    CODEX_REASONING_EFFORTS,
    type CodexApprovalPolicy,
    type CodexModelInfo,
    type CodexReasoningEffort,
    type CodexSandboxMode,
} from "@taskflow/shared";
import { CodexModelSelect } from "@/components/settings/CodexModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface CodexOptionsProps {
    modelValue: string;
    reasoningEffort: CodexReasoningEffort | "default";
    sandbox: CodexSandboxMode;
    approvalPolicy: CodexApprovalPolicy;
    dangerouslyBypassApprovalsAndSandbox: boolean;
    onModelChange: (value: string) => void;
    onReasoningEffortChange: (value: CodexReasoningEffort | "default") => void;
    onSandboxChange: (value: CodexSandboxMode) => void;
    onApprovalPolicyChange: (value: CodexApprovalPolicy) => void;
    onDangerouslyBypassApprovalsAndSandboxChange: (value: boolean) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Codex sessions",
        reasoning: "Default Reasoning",
        reasoningHint: "Reasoning effort for the selected model",
        bypass: "Bypass Safety",
        bypassHint: "Disable approvals and sandboxing by default (dangerous)",
        sandbox: "Sandbox",
        sandboxHint: "Default sandbox policy for model-generated shell commands",
        approvalPolicy: "Approval Policy",
        approvalPolicyHint: "Default approval policy for commands",
    },
    session: {
        model: "Model",
        modelHint: "Model for this Codex session",
        reasoning: "Reasoning",
        reasoningHint: "Reasoning effort for the selected model",
        bypass: "Bypass Safety",
        bypassHint: "Run without approvals or sandboxing (dangerous)",
        sandbox: "Sandbox",
        sandboxHint: "Sandbox policy for model-generated shell commands",
        approvalPolicy: "Approval Policy",
        approvalPolicyHint: "When to ask for approval of commands",
    },
};

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function CodexOptions({
    modelValue,
    reasoningEffort,
    sandbox,
    approvalPolicy,
    dangerouslyBypassApprovalsAndSandbox,
    onModelChange,
    onReasoningEffortChange,
    onSandboxChange,
    onApprovalPolicyChange,
    onDangerouslyBypassApprovalsAndSandboxChange,
    mode = "session",
}: CodexOptionsProps) {
    const labels = LABELS[mode];
    const bypassId = useId();
    const [models, setModels] = useState<CodexModelInfo[]>([]);
    const selectedModel = useMemo(
        () =>
            modelValue
                ? models.find((model) => model.model === modelValue || model.id === modelValue)
                : models.find((model) => model.isDefault),
        [modelValue, models],
    );
    const supportedReasoningEfforts = useMemo(() => {
        const supported = selectedModel?.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
        );
        return supported?.length ? supported : [...CODEX_REASONING_EFFORTS];
    }, [selectedModel]);

    useEffect(() => {
        if (
            reasoningEffort !== "default" &&
            selectedModel &&
            !selectedModel.supportedReasoningEfforts.some(
                (effort) => effort.reasoningEffort === reasoningEffort,
            )
        ) {
            onReasoningEffortChange("default");
        }
    }, [onReasoningEffortChange, reasoningEffort, selectedModel]);

    const handleModelChange = useCallback(
        (nextModel: string) => {
            const model = nextModel
                ? models.find(
                      (candidate) => candidate.model === nextModel || candidate.id === nextModel,
                  )
                : models.find((candidate) => candidate.isDefault);
            if (
                reasoningEffort !== "default" &&
                model &&
                !model.supportedReasoningEfforts.some(
                    (effort) => effort.reasoningEffort === reasoningEffort,
                )
            ) {
                onReasoningEffortChange("default");
            }
            onModelChange(nextModel);
        },
        [models, onModelChange, onReasoningEffortChange, reasoningEffort],
    );

    return (
        <>
            <SettingRow label={labels.model} hint={labels.modelHint}>
                <div className="w-[220px]">
                    <CodexModelSelect
                        value={modelValue}
                        onChange={handleModelChange}
                        onModelsChange={setModels}
                    />
                </div>
            </SettingRow>
            <SettingRow label={labels.reasoning} hint={labels.reasoningHint}>
                <Select
                    value={reasoningEffort}
                    onValueChange={(value) =>
                        onReasoningEffortChange(value as CodexReasoningEffort | "default")
                    }>
                    <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">
                            Model default
                            {selectedModel ? ` (${selectedModel.defaultReasoningEffort})` : ""}
                        </SelectItem>
                        {supportedReasoningEfforts.map((effort) => (
                            <SelectItem key={effort} value={effort}>
                                {capitalize(effort)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={labels.bypass} hint={labels.bypassHint} className="h-8">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id={bypassId}
                        checked={dangerouslyBypassApprovalsAndSandbox}
                        onCheckedChange={onDangerouslyBypassApprovalsAndSandboxChange}
                    />
                    <Label
                        htmlFor={bypassId}
                        className={`${dangerouslyBypassApprovalsAndSandbox ? "text-destructive" : "text-muted-foreground"} cursor-pointer text-[13px] font-normal normal-case`}>
                        {dangerouslyBypassApprovalsAndSandbox ? "YOLO enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow label={labels.sandbox} hint={labels.sandboxHint}>
                <Select
                    value={sandbox}
                    onValueChange={(value) => onSandboxChange(value as CodexSandboxMode)}
                    disabled={dangerouslyBypassApprovalsAndSandbox}>
                    <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="read-only">Read only</SelectItem>
                        <SelectItem value="workspace-write">Workspace write</SelectItem>
                        <SelectItem value="danger-full-access">Full access (dangerous)</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={labels.approvalPolicy} hint={labels.approvalPolicyHint}>
                <Select
                    value={approvalPolicy}
                    onValueChange={(value) => onApprovalPolicyChange(value as CodexApprovalPolicy)}
                    disabled={dangerouslyBypassApprovalsAndSandbox}>
                    <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="untrusted">Untrusted commands</SelectItem>
                        <SelectItem value="on-request">On request</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                </Select>
            </SettingRow>
        </>
    );
}

export { CodexOptions };
