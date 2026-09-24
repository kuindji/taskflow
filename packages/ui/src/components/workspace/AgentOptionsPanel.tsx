import { useState, useEffect, useRef, useCallback } from "react";
import {
    isVersionAtLeast,
    INHERIT_AGENT_ACCOUNT,
    type AgentLaunchOptions,
    type AgentType,
    type ClaudePermissionMode,
    type ClaudeEffortLevel,
    type CodexSandboxMode,
    type CodexApprovalPolicy,
    type CodexReasoningEffort,
    type PiThinkingLevel,
    type KimiPermissionMode,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw } from "lucide-react";
import { useBackendStore } from "@/stores/backend-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { CodexOptions } from "@/components/shared/CodexOptions";
import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";
import { PiOptions } from "@/components/shared/PiOptions";
import { KimiOptions } from "@/components/shared/KimiOptions";
import { AgentAccountSelect } from "@/components/shared/AgentAccountSelect";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";

interface AgentOptionsPanelProps {
    /**
     * The machine that will run the agent, whose defaults prefill the options.
     * Omitted where the options are saved rather than launched: primary's.
     */
    backendId?: string;
    agentType: AgentType;
    value?: AgentLaunchOptions;
    emitOnMount?: boolean;
    /**
     * One-shot text generation (built-in helpers). Hides and omits
     * session-only fields (permissions, sandbox, approvals, auto-approve,
     * tools) and does not prefill from the machine's session defaults: an
     * unset field means the agent CLI's own default.
     */
    headless?: boolean;
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
    onReset?: () => void;
}

function AgentOptionsPanel({
    backendId,
    agentType,
    value,
    emitOnMount = false,
    headless = false,
    onRun,
    onChange,
    onReset,
}: AgentOptionsPanelProps) {
    const settings = useSettingsStore((s) =>
        backendId ? (s.byBackend[backendId] ?? null) : s.settings,
    );
    // Headless runs don't use the machine's session defaults.
    const defaults = headless ? null : settings;
    const claudeSettings = defaults?.claude;
    const codexSettings = defaults?.codex;
    const opencodeSettings = defaults?.opencode;
    const piSettings = defaults?.pi;
    const kimiSettings = defaults?.kimi;
    const primaryId = useBackendStore((s) => s.primaryId);
    const agentBackendId = backendId ?? primaryId;
    const agents = useAgentAvailability(agentBackendId);
    const claudeVersion = agents.find((agent) => agent.type === "claude")?.version;
    const supportsClaudeUltracode = !claudeVersion || isVersionAtLeast(claudeVersion, [2, 1, 203]);

    const matchingValue = value?.type === agentType ? value : undefined;

    // --- Claude-specific defaults ---
    const defaultPermissionMode =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.permissionMode ?? claudeSettings?.permissionMode ?? "default")
            : agentType === "claude"
              ? (claudeSettings?.permissionMode ?? "default")
              : "default";

    const defaultEffort =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.effort ?? claudeSettings?.defaultEffort ?? "default")
            : agentType === "claude"
              ? (claudeSettings?.defaultEffort ?? "default")
              : "default";

    // --- Codex-specific defaults ---
    const defaultDangerouslyBypassApprovalsAndSandbox =
        matchingValue?.type === "codex"
            ? (matchingValue.dangerouslyBypassApprovalsAndSandbox ??
              codexSettings?.dangerouslyBypassApprovalsAndSandbox ??
              false)
            : (codexSettings?.dangerouslyBypassApprovalsAndSandbox ?? false);
    const defaultCodexReasoningEffort: CodexReasoningEffort | "default" =
        matchingValue?.type === "codex"
            ? (matchingValue.reasoningEffort ?? codexSettings?.defaultReasoningEffort ?? "default")
            : (codexSettings?.defaultReasoningEffort ?? "default");
    const defaultCodexSandbox: CodexSandboxMode =
        matchingValue?.type === "codex"
            ? (matchingValue.sandbox ?? codexSettings?.sandbox ?? "workspace-write")
            : (codexSettings?.sandbox ?? "workspace-write");
    const defaultApprovalPolicy: CodexApprovalPolicy =
        matchingValue?.type === "codex"
            ? (matchingValue.approvalPolicy ?? codexSettings?.approvalPolicy ?? "on-request")
            : (codexSettings?.approvalPolicy ?? "on-request");

    // --- OpenCode-specific defaults ---
    const defaultOcAutoApprove =
        matchingValue?.type === "opencode"
            ? (matchingValue.autoApprove ?? opencodeSettings?.autoApprove ?? false)
            : (opencodeSettings?.autoApprove ?? false);

    // --- Pi-specific defaults ---
    const defaultPiThinking: PiThinkingLevel =
        matchingValue?.type === "pi"
            ? (matchingValue.thinking ?? piSettings?.thinking ?? "off")
            : (piSettings?.thinking ?? "off");
    const defaultPiTools =
        matchingValue?.type === "pi"
            ? (matchingValue.tools ?? piSettings?.tools ?? "")
            : (piSettings?.tools ?? "");

    // --- Kimi-specific defaults ---
    const defaultKimiPermissionMode: KimiPermissionMode =
        matchingValue?.type === "kimi"
            ? (matchingValue.permissionMode ?? kimiSettings?.permissionMode ?? "manual")
            : (kimiSettings?.permissionMode ?? "manual");

    // --- Model defaults (shared across agents) ---
    const defaultModel =
        agentType === "codex" && matchingValue?.type === "codex"
            ? (matchingValue.model ?? codexSettings?.defaultModel ?? "")
            : agentType === "claude" && matchingValue?.type === "claude"
              ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
              : agentType === "opencode" && matchingValue?.type === "opencode"
                ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
                : agentType === "pi" && matchingValue?.type === "pi"
                  ? (matchingValue.model ?? piSettings?.defaultModel ?? "")
                  : agentType === "kimi" && matchingValue?.type === "kimi"
                    ? (matchingValue.model ?? kimiSettings?.defaultModel ?? "")
                    : agentType === "codex"
                      ? (codexSettings?.defaultModel ?? "")
                      : agentType === "claude"
                        ? (claudeSettings?.defaultModel ?? "default")
                        : agentType === "opencode"
                          ? (opencodeSettings?.defaultModel ?? "")
                          : agentType === "pi"
                            ? (piSettings?.defaultModel ?? "")
                            : agentType === "kimi"
                              ? (kimiSettings?.defaultModel ?? "")
                              : "default";

    // --- Account (never prefilled from settings: absent means inherit) ---
    const defaultAccount =
        matchingValue?.type === "claude" || matchingValue?.type === "codex"
            ? (matchingValue.account ?? INHERIT_AGENT_ACCOUNT)
            : INHERIT_AGENT_ACCOUNT;
    const accountList =
        agentType === "claude"
            ? (settings?.claude.accounts ?? [])
            : agentType === "codex"
              ? (settings?.codex.accounts ?? [])
              : [];

    // --- State ---
    const [permissionMode, setPermissionMode] = useState<string>(defaultPermissionMode);
    const [effort, setEffort] = useState<string>(defaultEffort);
    const [dangerouslyBypassApprovalsAndSandbox, setDangerouslyBypassApprovalsAndSandbox] =
        useState(defaultDangerouslyBypassApprovalsAndSandbox);
    const [codexReasoningEffort, setCodexReasoningEffort] = useState<
        CodexReasoningEffort | "default"
    >(defaultCodexReasoningEffort);
    const [codexSandbox, setCodexSandbox] = useState<CodexSandboxMode>(defaultCodexSandbox);
    const [approvalPolicy, setApprovalPolicy] =
        useState<CodexApprovalPolicy>(defaultApprovalPolicy);
    const [ocAutoApprove, setOcAutoApprove] = useState(defaultOcAutoApprove);
    const [model, setModel] = useState<string>(defaultModel);
    const [piThinking, setPiThinking] = useState<PiThinkingLevel>(defaultPiThinking);
    const [piTools, setPiTools] = useState<string>(defaultPiTools);
    const [kimiPermissionMode, setKimiPermissionMode] =
        useState<KimiPermissionMode>(defaultKimiPermissionMode);
    const [account, setAccount] = useState<string>(defaultAccount);

    const isFirstRender = useRef(true);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (agentType === "claude") {
            setPermissionMode(defaultPermissionMode);
            setEffort(defaultEffort);
            setModel(defaultModel);
            setAccount(defaultAccount);
        } else if (agentType === "codex") {
            setDangerouslyBypassApprovalsAndSandbox(defaultDangerouslyBypassApprovalsAndSandbox);
            setCodexReasoningEffort(defaultCodexReasoningEffort);
            setCodexSandbox(defaultCodexSandbox);
            setApprovalPolicy(defaultApprovalPolicy);
            setModel(defaultModel);
            setAccount(defaultAccount);
        } else if (agentType === "opencode") {
            setOcAutoApprove(defaultOcAutoApprove);
            setModel(defaultModel);
        } else if (agentType === "pi") {
            setPiThinking(defaultPiThinking);
            setPiTools(defaultPiTools);
            setModel(defaultModel);
        } else if (agentType === "kimi") {
            setKimiPermissionMode(defaultKimiPermissionMode);
            setModel(defaultModel);
        }
    }, [
        agentType,
        defaultPermissionMode,
        defaultEffort,
        defaultDangerouslyBypassApprovalsAndSandbox,
        defaultCodexReasoningEffort,
        defaultCodexSandbox,
        defaultApprovalPolicy,
        defaultOcAutoApprove,
        defaultPiThinking,
        defaultPiTools,
        defaultKimiPermissionMode,
        defaultModel,
        defaultAccount,
    ]);

    const buildClaudeOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "claude",
            permissionMode:
                headless || permissionMode === "default"
                    ? undefined
                    : (permissionMode as ClaudePermissionMode),
            model: model === "default" ? undefined : model || undefined,
            effort: effort === "default" ? undefined : (effort as ClaudeEffortLevel),
            account: account === INHERIT_AGENT_ACCOUNT ? undefined : account,
        }),
        [permissionMode, model, effort, account, headless],
    );

    const buildCodexOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "codex",
            model: model || undefined,
            reasoningEffort: codexReasoningEffort === "default" ? undefined : codexReasoningEffort,
            sandbox: headless ? undefined : codexSandbox || undefined,
            approvalPolicy: headless ? undefined : approvalPolicy || undefined,
            dangerouslyBypassApprovalsAndSandbox: headless
                ? undefined
                : dangerouslyBypassApprovalsAndSandbox || undefined,
            account: account === INHERIT_AGENT_ACCOUNT ? undefined : account,
        }),
        [
            model,
            codexReasoningEffort,
            codexSandbox,
            approvalPolicy,
            dangerouslyBypassApprovalsAndSandbox,
            account,
            headless,
        ],
    );

    const buildOpenCodeOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "opencode",
            model: model || undefined,
            autoApprove: headless ? undefined : ocAutoApprove || undefined,
        }),
        [model, ocAutoApprove, headless],
    );

    const buildPiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "pi",
            model: model || undefined,
            thinking: piThinking === "off" ? undefined : piThinking,
            tools: headless ? undefined : piTools.trim() || undefined,
        }),
        [model, piThinking, piTools, headless],
    );

    const buildKimiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "kimi",
            model: model || undefined,
            permissionMode:
                headless || kimiPermissionMode === "manual" ? undefined : kimiPermissionMode,
        }),
        [model, kimiPermissionMode, headless],
    );

    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "claude") return buildClaudeOptions();
        if (agentType === "codex") return buildCodexOptions();
        if (agentType === "opencode") return buildOpenCodeOptions();
        if (agentType === "pi") return buildPiOptions();
        if (agentType === "kimi") return buildKimiOptions();
        return { type: "codex" };
    }, [
        agentType,
        buildClaudeOptions,
        buildCodexOptions,
        buildOpenCodeOptions,
        buildPiOptions,
        buildKimiOptions,
    ]);

    const emitChange = useCallback(() => {
        const cb = onChangeRef.current;
        if (!cb) return;
        cb(buildOptions());
    }, [buildOptions]);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            if (!emitOnMount) return;
        }
        emitChange();
    }, [emitOnMount, emitChange]);

    const handleRun = useCallback(() => {
        if (!onRun) return;
        onRun(buildOptions());
    }, [buildOptions, onRun]);

    return (
        <div className="flex flex-col gap-3">
            {agentType === "claude" ? (
                <>
                    <ClaudeOptions
                        headless={headless}
                        modelValue={model}
                        effortValue={effort}
                        permissionMode={permissionMode}
                        supportsUltracode={supportsClaudeUltracode}
                        onModelChange={setModel}
                        onEffortChange={setEffort}
                        onPermissionModeChange={setPermissionMode}
                    />
                    {(accountList.length > 0 || account !== INHERIT_AGENT_ACCOUNT) && (
                        <AgentAccountSelect
                            label="Account"
                            hint="Subscription this session runs under"
                            accounts={accountList}
                            value={account}
                            inheritLabel="Inherit (project → default)"
                            onChange={setAccount}
                        />
                    )}
                </>
            ) : agentType === "codex" ? (
                <>
                    <CodexOptions
                        headless={headless}
                        backendId={agentBackendId}
                        modelValue={model}
                        reasoningEffort={codexReasoningEffort}
                        sandbox={codexSandbox}
                        approvalPolicy={approvalPolicy}
                        dangerouslyBypassApprovalsAndSandbox={dangerouslyBypassApprovalsAndSandbox}
                        onModelChange={setModel}
                        onReasoningEffortChange={setCodexReasoningEffort}
                        onSandboxChange={setCodexSandbox}
                        onApprovalPolicyChange={setApprovalPolicy}
                        onDangerouslyBypassApprovalsAndSandboxChange={
                            setDangerouslyBypassApprovalsAndSandbox
                        }
                    />
                    {(accountList.length > 0 || account !== INHERIT_AGENT_ACCOUNT) && (
                        <AgentAccountSelect
                            label="Account"
                            hint="Subscription this session runs under"
                            accounts={accountList}
                            value={account}
                            inheritLabel="Inherit (project → default)"
                            onChange={setAccount}
                        />
                    )}
                </>
            ) : agentType === "opencode" ? (
                <OpenCodeOptions
                    headless={headless}
                    backendId={agentBackendId}
                    modelValue={model}
                    autoApprove={ocAutoApprove}
                    onModelChange={setModel}
                    onAutoApproveChange={setOcAutoApprove}
                />
            ) : agentType === "pi" ? (
                <PiOptions
                    headless={headless}
                    backendId={agentBackendId}
                    modelValue={model}
                    thinkingValue={piThinking}
                    toolsValue={piTools}
                    onModelChange={setModel}
                    onThinkingChange={setPiThinking}
                    onToolsChange={setPiTools}
                />
            ) : agentType === "kimi" ? (
                <KimiOptions
                    headless={headless}
                    backendId={agentBackendId}
                    modelValue={model}
                    permissionMode={kimiPermissionMode}
                    onModelChange={setModel}
                    onPermissionModeChange={setKimiPermissionMode}
                />
            ) : null}

            {onReset && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground w-full text-xs"
                    onClick={onReset}>
                    <RotateCcw className="mr-1 h-3 w-3" />
                    Reset to defaults
                </Button>
            )}

            {onRun && (
                <Button size="sm" className="w-full" onClick={handleRun}>
                    <Play className="mr-1 h-3 w-3" />
                    Run
                </Button>
            )}
        </div>
    );
}

export { AgentOptionsPanel };
