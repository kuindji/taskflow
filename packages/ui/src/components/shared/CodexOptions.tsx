import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
    CODEX_REASONING_EFFORTS,
    type CodexApprovalPolicy,
    type CodexModelInfo,
    type CodexReasoningEffort,
    type CodexSandboxMode,
    type CodexSettings,
} from "@taskflow/shared";
import { loadCodexDiscovery } from "@/lib/agent-discovery";
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
import { capitalize, launchDefaultLabel, type Inheritable } from "./launch-defaults";

interface CodexOptionsProps {
    /** The machine whose Codex CLI lists the models. */
    backendId: string | null;
    account?: string;
    projectId?: string;
    discoveryKey?: string;
    loadDiscovery?: typeof loadCodexDiscovery;
    modelValue: string;
    /** "default" leaves the field unset. Only session mode offers it for sandbox, approvals and bypass. */
    reasoningEffort: Inheritable<CodexReasoningEffort>;
    sandbox: Inheritable<CodexSandboxMode>;
    approvalPolicy: Inheritable<CodexApprovalPolicy>;
    dangerouslyBypassApprovalsAndSandbox: Inheritable<boolean>;
    onModelChange: (value: string) => void;
    onReasoningEffortChange: (value: Inheritable<CodexReasoningEffort>) => void;
    onSandboxChange: (value: Inheritable<CodexSandboxMode>) => void;
    onApprovalPolicyChange: (value: Inheritable<CodexApprovalPolicy>) => void;
    onDangerouslyBypassApprovalsAndSandboxChange: (value: Inheritable<boolean>) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
    /** One-shot headless run: hide fields that only matter to an interactive session. */
    headless?: boolean;
    /** Session mode: the machine's Settings, which fill unset fields; null while loading. */
    settings?: CodexSettings | null;
}

const SANDBOX_LABELS: Record<CodexSandboxMode, string> = {
    "read-only": "Read only",
    "workspace-write": "Workspace write",
    "danger-full-access": "Full access (dangerous)",
};

const APPROVAL_LABELS: Record<CodexApprovalPolicy, string> = {
    untrusted: "Untrusted commands",
    "on-request": "On request",
    never: "Never",
};

function bypassLabel(enabled: boolean): string {
    return enabled ? "YOLO enabled" : "Disabled";
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

function CodexOptions(props: CodexOptionsProps) {
    return (
        <CodexOptionsContext
            key={JSON.stringify([
                props.backendId,
                props.account,
                props.projectId,
                props.discoveryKey,
            ])}
            {...props}
        />
    );
}

function CodexOptionsContext({
    backendId,
    account,
    projectId,
    discoveryKey,
    loadDiscovery,
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
    headless = false,
    settings,
}: CodexOptionsProps) {
    const labels = LABELS[mode];
    const bypassId = useId();
    const [models, setModels] = useState<CodexModelInfo[]>([]);
    // Session fields left at "default" launch with the machine's Settings.
    // Headless runs ignore Settings; the Settings page itself has none above it.
    const inheritsSettings = mode === "session" && !headless;
    const inherited = inheritsSettings ? settings : null;
    const findModel = useCallback(
        (value: string) =>
            value
                ? models.find((model) => model.model === value || model.id === value)
                : models.find((model) => model.isDefault),
        [models],
    );
    const selectedModel = useMemo(
        () => findModel(modelValue || (inherited?.defaultModel ?? "")),
        [findModel, inherited?.defaultModel, modelValue],
    );
    const effectiveEffort =
        reasoningEffort === "default"
            ? (inherited?.defaultReasoningEffort ?? "default")
            : reasoningEffort;
    const effectiveBypass =
        dangerouslyBypassApprovalsAndSandbox === "default"
            ? (inherited?.dangerouslyBypassApprovalsAndSandbox ?? false)
            : dangerouslyBypassApprovalsAndSandbox;
    // Text of a Settings value for a session "Default" choice.
    const sessionDefault = (text: string | null | undefined) =>
        launchDefaultLabel("Codex", headless ? null : text);
    const settingsModelText = !settings
        ? undefined
        : settings.defaultModel
          ? (models.find(
                (model) =>
                    model.model === settings.defaultModel || model.id === settings.defaultModel,
            )?.displayName ?? settings.defaultModel)
          : null;
    const supportedReasoningEfforts = useMemo(() => {
        const supported = selectedModel?.supportedReasoningEfforts.map(
            (effort) => effort.reasoningEffort,
        );
        return supported?.length ? supported : [...CODEX_REASONING_EFFORTS];
    }, [selectedModel]);

    // A session's omitted effort is filled from the machine default (possibly
    // the very level just rejected), so there the fallback is the model's own
    // default, spelled out. The machine default itself may stay "default".
    const fallbackEffort = useCallback(
        (model: CodexModelInfo): CodexReasoningEffort | "default" =>
            mode === "defaults" ? "default" : model.defaultReasoningEffort,
        [mode],
    );

    // An inherited effort counts too: the launch would pass the Settings level.
    useEffect(() => {
        if (
            effectiveEffort !== "default" &&
            selectedModel &&
            !selectedModel.supportedReasoningEfforts.some(
                (effort) => effort.reasoningEffort === effectiveEffort,
            )
        ) {
            onReasoningEffortChange(fallbackEffort(selectedModel));
        }
    }, [effectiveEffort, fallbackEffort, onReasoningEffortChange, selectedModel]);

    const handleModelChange = useCallback(
        (nextModel: string) => {
            const model = findModel(nextModel || (inherited?.defaultModel ?? ""));
            if (
                effectiveEffort !== "default" &&
                model &&
                !model.supportedReasoningEfforts.some(
                    (effort) => effort.reasoningEffort === effectiveEffort,
                )
            ) {
                onReasoningEffortChange(fallbackEffort(model));
            }
            onModelChange(nextModel);
        },
        [
            effectiveEffort,
            fallbackEffort,
            findModel,
            inherited?.defaultModel,
            onModelChange,
            onReasoningEffortChange,
        ],
    );

    return (
        <>
            <SettingRow label={labels.model} hint={labels.modelHint}>
                <div className="w-[220px]">
                    <CodexModelSelect
                        backendId={backendId}
                        account={account}
                        projectId={projectId}
                        discoveryKey={discoveryKey}
                        loadDiscovery={loadDiscovery}
                        value={modelValue}
                        onChange={handleModelChange}
                        onModelsChange={setModels}
                        inheritedLabel={
                            inheritsSettings ? sessionDefault(settingsModelText) : undefined
                        }
                    />
                </div>
            </SettingRow>
            <SettingRow label={labels.reasoning} hint={labels.reasoningHint}>
                <Select
                    value={reasoningEffort}
                    onValueChange={(value) =>
                        onReasoningEffortChange(value as Inheritable<CodexReasoningEffort>)
                    }>
                    <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">
                            {mode === "defaults"
                                ? `Model default${selectedModel ? ` (${selectedModel.defaultReasoningEffort})` : ""}`
                                : sessionDefault(
                                      !settings
                                          ? undefined
                                          : settings.defaultReasoningEffort === "default"
                                            ? null
                                            : capitalize(settings.defaultReasoningEffort),
                                  )}
                        </SelectItem>
                        {supportedReasoningEfforts.map((effort) => (
                            <SelectItem key={effort} value={effort}>
                                {capitalize(effort)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
            {!headless && (
                <>
                    <SettingRow label={labels.bypass} hint={labels.bypassHint} className="h-8">
                        {inheritsSettings ? (
                            <Select
                                value={String(dangerouslyBypassApprovalsAndSandbox)}
                                onValueChange={(value) =>
                                    onDangerouslyBypassApprovalsAndSandboxChange(
                                        value === "default" ? "default" : value === "true",
                                    )
                                }>
                                <SelectTrigger
                                    size="sm"
                                    className={`w-[220px] text-[13px] ${effectiveBypass ? "text-destructive" : ""}`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings
                                                ? bypassLabel(
                                                      settings.dangerouslyBypassApprovalsAndSandbox,
                                                  )
                                                : undefined,
                                        )}
                                    </SelectItem>
                                    <SelectItem value="true">{bypassLabel(true)}</SelectItem>
                                    <SelectItem value="false">{bypassLabel(false)}</SelectItem>
                                </SelectContent>
                            </Select>
                        ) : (
                            <div className="flex items-center gap-2.5">
                                <Switch
                                    id={bypassId}
                                    checked={effectiveBypass}
                                    onCheckedChange={onDangerouslyBypassApprovalsAndSandboxChange}
                                />
                                <Label
                                    htmlFor={bypassId}
                                    className={`${effectiveBypass ? "text-destructive" : "text-muted-foreground"} cursor-pointer text-[13px] font-normal normal-case`}>
                                    {bypassLabel(effectiveBypass)}
                                </Label>
                            </div>
                        )}
                    </SettingRow>
                    <SettingRow label={labels.sandbox} hint={labels.sandboxHint}>
                        <Select
                            value={sandbox}
                            onValueChange={(value) =>
                                onSandboxChange(value as Inheritable<CodexSandboxMode>)
                            }
                            disabled={effectiveBypass}>
                            <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {inheritsSettings && (
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings ? SANDBOX_LABELS[settings.sandbox] : undefined,
                                        )}
                                    </SelectItem>
                                )}
                                {Object.entries(SANDBOX_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </SettingRow>
                    <SettingRow label={labels.approvalPolicy} hint={labels.approvalPolicyHint}>
                        <Select
                            value={approvalPolicy}
                            onValueChange={(value) =>
                                onApprovalPolicyChange(value as Inheritable<CodexApprovalPolicy>)
                            }
                            disabled={effectiveBypass}>
                            <SelectTrigger size="sm" className="w-[220px] text-[13px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {inheritsSettings && (
                                    <SelectItem value="default">
                                        {sessionDefault(
                                            settings
                                                ? APPROVAL_LABELS[settings.approvalPolicy]
                                                : undefined,
                                        )}
                                    </SelectItem>
                                )}
                                {Object.entries(APPROVAL_LABELS).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </SettingRow>
                </>
            )}
        </>
    );
}

export { CodexOptions };
