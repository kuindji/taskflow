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
import { loadCodexDiscovery } from "@/lib/agent-discovery";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { CodexOptions } from "@/components/shared/CodexOptions";
import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";
import { PiOptions } from "@/components/shared/PiOptions";
import { KimiOptions } from "@/components/shared/KimiOptions";
import { AgentAccountSelect } from "@/components/shared/AgentAccountSelect";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { normalizeAgentOptions } from "@/lib/normalize-agent-options";
import type { Inheritable } from "@/components/shared/launch-defaults";

interface AgentOptionsPanelProps {
    /**
     * The machine that will run the agent, whose Settings fill unset options
     * and label them. Omitted where the options are saved rather than
     * launched: primary's.
     */
    backendId?: string;
    projectId?: string;
    loadDiscovery?: typeof loadCodexDiscovery;
    agentType: AgentType;
    value?: AgentLaunchOptions;
    emitOnMount?: boolean;
    /**
     * One-shot text generation (built-in helpers). Hides and omits
     * session-only fields (permissions, sandbox, approvals, auto-approve,
     * tools); an unset field means the agent CLI's own default, not the
     * machine's Settings.
     */
    headless?: boolean;
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
    onReset?: () => void;
}

function AgentOptionsPanel({
    backendId,
    projectId,
    loadDiscovery,
    agentType,
    value,
    emitOnMount = false,
    headless = false,
    onRun,
    onChange,
    onReset,
}: AgentOptionsPanelProps) {
    const primaryId = useBackendStore((s) => s.primaryId);
    const agentBackendId = backendId ?? primaryId;
    const settings = useSettingsStore((s) =>
        backendId ? (s.byBackend[backendId] ?? null) : s.settings,
    );
    const projectAccount = useProjectStore(
        (s) =>
            s.projects.find(
                (project) => project.backendId === agentBackendId && project.id === projectId,
            )?.agentAccounts?.codex,
    );
    const discoveryKey = JSON.stringify([
        settings?.codex.accounts,
        settings?.codex.defaultAccount,
        projectAccount,
    ]);
    const agents = useAgentAvailability(agentBackendId);
    const claudeVersion = agents.find((agent) => agent.type === "claude")?.version;
    const supportsClaudeUltracode = !claudeVersion || isVersionAtLeast(claudeVersion, [2, 1, 203]);

    // Normalized so stored legacy shapes (Claude's dangerouslySkipPermissions)
    // load as the value the backend would launch with.
    const matchingValue = normalizeAgentOptions(agentType, value);
    const claudeValue = matchingValue?.type === "claude" ? matchingValue : undefined;
    const codexValue = matchingValue?.type === "codex" ? matchingValue : undefined;
    const opencodeValue = matchingValue?.type === "opencode" ? matchingValue : undefined;
    const piValue = matchingValue?.type === "pi" ? matchingValue : undefined;
    const kimiValue = matchingValue?.type === "kimi" ? matchingValue : undefined;

    // A stored field loads as chosen; an absent one as "default", which stays
    // out of the payload so the backend fills it from the machine's Settings
    // at launch time (the CLI's own default for headless runs). The controls
    // label it with that Settings value.
    const defaultPermissionMode = claudeValue?.permissionMode ?? "default";
    const defaultEffort = claudeValue?.effort ?? "default";
    const defaultDangerouslyBypassApprovalsAndSandbox: Inheritable<boolean> =
        codexValue?.dangerouslyBypassApprovalsAndSandbox ?? "default";
    const defaultCodexReasoningEffort: Inheritable<CodexReasoningEffort> =
        codexValue?.reasoningEffort ?? "default";
    const defaultCodexSandbox: Inheritable<CodexSandboxMode> = codexValue?.sandbox ?? "default";
    const defaultApprovalPolicy: Inheritable<CodexApprovalPolicy> =
        codexValue?.approvalPolicy ?? "default";
    const defaultOcAutoApprove: Inheritable<boolean> = opencodeValue?.autoApprove ?? "default";
    const defaultPiThinking: Inheritable<PiThinkingLevel> = piValue?.thinking ?? "default";
    const defaultPiTools = piValue?.tools ?? null;
    const defaultKimiPermissionMode: Inheritable<KimiPermissionMode> =
        kimiValue?.permissionMode ?? "default";
    // Claude's model picker spells "unset" as "default", the others as "".
    const defaultModel = matchingValue?.model ?? (agentType === "claude" ? "default" : "");

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
    const [codexReasoningEffort, setCodexReasoningEffort] = useState(defaultCodexReasoningEffort);
    const [codexSandbox, setCodexSandbox] = useState(defaultCodexSandbox);
    const [approvalPolicy, setApprovalPolicy] = useState(defaultApprovalPolicy);
    const [ocAutoApprove, setOcAutoApprove] = useState(defaultOcAutoApprove);
    const [model, setModel] = useState<string>(defaultModel);
    const [piThinking, setPiThinking] = useState(defaultPiThinking);
    const [piTools, setPiTools] = useState(defaultPiTools);
    const [kimiPermissionMode, setKimiPermissionMode] = useState(defaultKimiPermissionMode);
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
            sandbox: headless || codexSandbox === "default" ? undefined : codexSandbox,
            approvalPolicy: headless || approvalPolicy === "default" ? undefined : approvalPolicy,
            // A chosen false stays explicit: omitted falls back to Settings.
            dangerouslyBypassApprovalsAndSandbox:
                headless || dangerouslyBypassApprovalsAndSandbox === "default"
                    ? undefined
                    : dangerouslyBypassApprovalsAndSandbox,
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
            autoApprove: headless || ocAutoApprove === "default" ? undefined : ocAutoApprove,
        }),
        [model, ocAutoApprove, headless],
    );

    const buildPiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "pi",
            model: model || undefined,
            // Headless leaves "off" unset: an unset field means the CLI's own default.
            thinking:
                piThinking === "default" || (headless && piThinking === "off")
                    ? undefined
                    : piThinking,
            tools: headless || piTools === null ? undefined : piTools.trim(),
        }),
        [model, piThinking, piTools, headless],
    );

    const buildKimiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "kimi",
            model: model || undefined,
            permissionMode:
                headless || kimiPermissionMode === "default" ? undefined : kimiPermissionMode,
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
                        settings={settings?.claude ?? null}
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
                        key={JSON.stringify([agentBackendId, account, projectId, discoveryKey])}
                        account={account === INHERIT_AGENT_ACCOUNT ? undefined : account}
                        projectId={projectId}
                        discoveryKey={discoveryKey}
                        loadDiscovery={loadDiscovery}
                        headless={headless}
                        settings={settings?.codex ?? null}
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
                    settings={settings?.opencode ?? null}
                    backendId={agentBackendId}
                    modelValue={model}
                    autoApprove={ocAutoApprove}
                    onModelChange={setModel}
                    onAutoApproveChange={setOcAutoApprove}
                />
            ) : agentType === "pi" ? (
                <PiOptions
                    headless={headless}
                    settings={settings?.pi ?? null}
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
                    settings={settings?.kimi ?? null}
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
