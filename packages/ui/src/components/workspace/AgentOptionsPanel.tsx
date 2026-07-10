import { useState, useEffect, useRef, useCallback } from "react";
import type {
    AgentLaunchOptions,
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
    CodexReasoningEffort,
    GeminiLaunchOptions,
    PiThinkingLevel,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { CodexOptions } from "@/components/shared/CodexOptions";
import { GeminiOptions } from "@/components/shared/GeminiOptions";
import { CursorOptions } from "@/components/shared/CursorOptions";
import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";
import { PiOptions } from "@/components/shared/PiOptions";

interface AgentOptionsPanelProps {
    agentType: AgentType;
    value?: AgentLaunchOptions;
    emitOnMount?: boolean;
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
    onReset?: () => void;
}

function AgentOptionsPanel({
    agentType,
    value,
    emitOnMount = false,
    onRun,
    onChange,
    onReset,
}: AgentOptionsPanelProps) {
    const claudeSettings = useSettingsStore((s) => s.settings?.claude);
    const codexSettings = useSettingsStore((s) => s.settings?.codex);
    const opencodeSettings = useSettingsStore((s) => s.settings?.opencode);
    const geminiSettings = useSettingsStore((s) => s.settings?.gemini);
    const cursorSettings = useSettingsStore((s) => s.settings?.cursor);
    const piSettings = useSettingsStore((s) => s.settings?.pi);

    const matchingValue = value?.type === agentType ? value : undefined;

    // --- Claude-specific defaults ---
    const defaultDangerouslySkipPermissions =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.dangerouslySkipPermissions ??
              claudeSettings?.dangerouslySkipPermissions ??
              false)
            : agentType === "claude"
              ? (claudeSettings?.dangerouslySkipPermissions ?? false)
              : false;

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
    const defaultOcVariant =
        matchingValue?.type === "opencode"
            ? (matchingValue.variant ?? opencodeSettings?.defaultVariant ?? "")
            : (opencodeSettings?.defaultVariant ?? "");
    const defaultOcAutoApprove =
        matchingValue?.type === "opencode"
            ? (matchingValue.autoApprove ?? opencodeSettings?.autoApprove ?? false)
            : (opencodeSettings?.autoApprove ?? false);

    // --- Gemini-specific defaults ---
    const defaultApprovalMode: NonNullable<GeminiLaunchOptions["approvalMode"]> =
        matchingValue?.type === "gemini"
            ? (matchingValue.approvalMode ?? geminiSettings?.approvalMode ?? "default")
            : agentType === "gemini"
              ? (geminiSettings?.approvalMode ?? "default")
              : "default";
    const defaultGeminiSandbox =
        matchingValue?.type === "gemini"
            ? (matchingValue.sandbox ?? geminiSettings?.sandbox ?? false)
            : agentType === "gemini"
              ? (geminiSettings?.sandbox ?? false)
              : false;

    // --- Cursor-specific defaults ---
    const defaultYolo =
        matchingValue?.type === "cursor"
            ? (matchingValue.yolo ?? cursorSettings?.yolo ?? false)
            : (cursorSettings?.yolo ?? false);

    // --- Pi-specific defaults ---
    const defaultPiThinking: PiThinkingLevel =
        matchingValue?.type === "pi"
            ? (matchingValue.thinking ?? piSettings?.thinking ?? "off")
            : (piSettings?.thinking ?? "off");
    const defaultPiTools =
        matchingValue?.type === "pi"
            ? (matchingValue.tools ?? piSettings?.tools ?? "")
            : (piSettings?.tools ?? "");

    // --- Model defaults (shared across agents) ---
    const defaultModel =
        agentType === "codex" && matchingValue?.type === "codex"
            ? (matchingValue.model ?? codexSettings?.defaultModel ?? "")
            : agentType === "claude" && matchingValue?.type === "claude"
              ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
              : agentType === "opencode" && matchingValue?.type === "opencode"
                ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
                : agentType === "gemini" && matchingValue?.type === "gemini"
                  ? (matchingValue.model ?? geminiSettings?.defaultModel ?? "")
                  : agentType === "cursor" && matchingValue?.type === "cursor"
                    ? (matchingValue.model ?? cursorSettings?.defaultModel ?? "default")
                    : agentType === "pi" && matchingValue?.type === "pi"
                      ? (matchingValue.model ?? piSettings?.defaultModel ?? "")
                      : agentType === "codex"
                        ? (codexSettings?.defaultModel ?? "")
                        : agentType === "claude"
                          ? (claudeSettings?.defaultModel ?? "default")
                          : agentType === "opencode"
                            ? (opencodeSettings?.defaultModel ?? "")
                            : agentType === "gemini"
                              ? (geminiSettings?.defaultModel ?? "")
                              : agentType === "cursor"
                                ? (cursorSettings?.defaultModel ?? "default")
                                : agentType === "pi"
                                  ? (piSettings?.defaultModel ?? "")
                                  : "default";

    // --- State ---
    const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(
        defaultDangerouslySkipPermissions,
    );
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
    const [ocVariant, setOcVariant] = useState(defaultOcVariant);
    const [ocAutoApprove, setOcAutoApprove] = useState(defaultOcAutoApprove);
    const [approvalMode, setApprovalMode] = useState(defaultApprovalMode);
    const [geminiSandbox, setGeminiSandbox] = useState(defaultGeminiSandbox);
    const [yolo, setYolo] = useState(defaultYolo);
    const [model, setModel] = useState<string>(defaultModel);
    const [piThinking, setPiThinking] = useState<PiThinkingLevel>(defaultPiThinking);
    const [piTools, setPiTools] = useState<string>(defaultPiTools);

    const isFirstRender = useRef(true);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (agentType === "claude") {
            setDangerouslySkipPermissions(defaultDangerouslySkipPermissions);
            setPermissionMode(defaultPermissionMode);
            setEffort(defaultEffort);
            setModel(defaultModel);
        } else if (agentType === "codex") {
            setDangerouslyBypassApprovalsAndSandbox(defaultDangerouslyBypassApprovalsAndSandbox);
            setCodexReasoningEffort(defaultCodexReasoningEffort);
            setCodexSandbox(defaultCodexSandbox);
            setApprovalPolicy(defaultApprovalPolicy);
            setModel(defaultModel);
        } else if (agentType === "opencode") {
            setOcVariant(defaultOcVariant);
            setOcAutoApprove(defaultOcAutoApprove);
            setModel(defaultModel);
        } else if (agentType === "gemini") {
            setApprovalMode(defaultApprovalMode);
            setGeminiSandbox(defaultGeminiSandbox);
            setModel(defaultModel);
        } else if (agentType === "cursor") {
            setYolo(defaultYolo);
            setModel(defaultModel);
        } else if (agentType === "pi") {
            setPiThinking(defaultPiThinking);
            setPiTools(defaultPiTools);
            setModel(defaultModel);
        }
    }, [
        agentType,
        defaultDangerouslySkipPermissions,
        defaultPermissionMode,
        defaultEffort,
        defaultDangerouslyBypassApprovalsAndSandbox,
        defaultCodexReasoningEffort,
        defaultCodexSandbox,
        defaultApprovalPolicy,
        defaultOcVariant,
        defaultOcAutoApprove,
        defaultApprovalMode,
        defaultGeminiSandbox,
        defaultYolo,
        defaultPiThinking,
        defaultPiTools,
        defaultModel,
    ]);

    const buildClaudeOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "claude",
            dangerouslySkipPermissions: dangerouslySkipPermissions || undefined,
            permissionMode:
                permissionMode === "default" ? undefined : (permissionMode as ClaudePermissionMode),
            model: model === "default" ? undefined : model || undefined,
            effort: effort === "default" ? undefined : (effort as ClaudeEffortLevel),
        }),
        [dangerouslySkipPermissions, permissionMode, model, effort],
    );

    const buildCodexOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "codex",
            model: model || undefined,
            reasoningEffort: codexReasoningEffort === "default" ? undefined : codexReasoningEffort,
            sandbox: codexSandbox || undefined,
            approvalPolicy: approvalPolicy || undefined,
            dangerouslyBypassApprovalsAndSandbox: dangerouslyBypassApprovalsAndSandbox || undefined,
        }),
        [
            model,
            codexReasoningEffort,
            codexSandbox,
            approvalPolicy,
            dangerouslyBypassApprovalsAndSandbox,
        ],
    );

    const buildOpenCodeOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "opencode",
            model: model || undefined,
            variant: ocVariant || undefined,
            autoApprove: ocAutoApprove || undefined,
        }),
        [model, ocVariant, ocAutoApprove],
    );

    const buildGeminiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "gemini",
            approvalMode: approvalMode === "default" ? undefined : approvalMode,
            sandbox: geminiSandbox || undefined,
            model: model || undefined,
        }),
        [approvalMode, geminiSandbox, model],
    );

    const buildCursorOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "cursor",
            yolo: yolo || undefined,
            model: model === "default" ? undefined : model,
        }),
        [yolo, model],
    );

    const buildPiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "pi",
            model: model || undefined,
            thinking: piThinking === "off" ? undefined : piThinking,
            tools: piTools.trim() || undefined,
        }),
        [model, piThinking, piTools],
    );

    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "claude") return buildClaudeOptions();
        if (agentType === "codex") return buildCodexOptions();
        if (agentType === "opencode") return buildOpenCodeOptions();
        if (agentType === "gemini") return buildGeminiOptions();
        if (agentType === "cursor") return buildCursorOptions();
        if (agentType === "pi") return buildPiOptions();
        return { type: "codex" };
    }, [
        agentType,
        buildClaudeOptions,
        buildCodexOptions,
        buildOpenCodeOptions,
        buildGeminiOptions,
        buildCursorOptions,
        buildPiOptions,
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
                <ClaudeOptions
                    modelValue={model}
                    effortValue={effort}
                    dangerouslySkipPermissions={dangerouslySkipPermissions}
                    permissionMode={permissionMode}
                    onModelChange={setModel}
                    onEffortChange={setEffort}
                    onSkipPermissions={setDangerouslySkipPermissions}
                    onPermissionModeChange={setPermissionMode}
                />
            ) : agentType === "codex" ? (
                <CodexOptions
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
            ) : agentType === "opencode" ? (
                <OpenCodeOptions
                    modelValue={model}
                    variantValue={ocVariant}
                    autoApprove={ocAutoApprove}
                    onModelChange={setModel}
                    onVariantChange={setOcVariant}
                    onAutoApproveChange={setOcAutoApprove}
                />
            ) : agentType === "gemini" ? (
                <GeminiOptions
                    modelValue={model}
                    approvalMode={approvalMode ?? "default"}
                    sandbox={geminiSandbox}
                    onModelChange={setModel}
                    onApprovalModeChange={(v) =>
                        setApprovalMode(v as NonNullable<GeminiLaunchOptions["approvalMode"]>)
                    }
                    onSandboxChange={setGeminiSandbox}
                />
            ) : agentType === "cursor" ? (
                <CursorOptions
                    modelValue={model}
                    yolo={yolo}
                    onModelChange={setModel}
                    onYoloChange={setYolo}
                />
            ) : agentType === "pi" ? (
                <PiOptions
                    modelValue={model}
                    thinkingValue={piThinking}
                    toolsValue={piTools}
                    onModelChange={setModel}
                    onThinkingChange={setPiThinking}
                    onToolsChange={setPiTools}
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
