import { useState, useEffect, useRef, useCallback } from "react";
import type {
    AgentLaunchOptions,
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
    GeminiLaunchOptions,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { CodexOptions } from "@/components/shared/CodexOptions";
import { GeminiOptions } from "@/components/shared/GeminiOptions";
import { CursorOptions } from "@/components/shared/CursorOptions";
import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";

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
    const defaultFullAuto =
        matchingValue?.type === "codex"
            ? (matchingValue.fullAuto ?? codexSettings?.fullAuto ?? false)
            : (codexSettings?.fullAuto ?? false);
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
                              : "default";

    // --- State ---
    const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(
        defaultDangerouslySkipPermissions,
    );
    const [permissionMode, setPermissionMode] = useState<string>(defaultPermissionMode);
    const [effort, setEffort] = useState<string>(defaultEffort);
    const [fullAuto, setFullAuto] = useState(defaultFullAuto);
    const [codexSandbox, setCodexSandbox] = useState<CodexSandboxMode>(defaultCodexSandbox);
    const [approvalPolicy, setApprovalPolicy] =
        useState<CodexApprovalPolicy>(defaultApprovalPolicy);
    const [ocVariant, setOcVariant] = useState(defaultOcVariant);
    const [ocAutoApprove, setOcAutoApprove] = useState(defaultOcAutoApprove);
    const [approvalMode, setApprovalMode] = useState(defaultApprovalMode);
    const [geminiSandbox, setGeminiSandbox] = useState(defaultGeminiSandbox);
    const [yolo, setYolo] = useState(defaultYolo);
    const [model, setModel] = useState<string>(defaultModel);

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
            setFullAuto(defaultFullAuto);
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
        }
    }, [
        agentType,
        defaultDangerouslySkipPermissions,
        defaultPermissionMode,
        defaultEffort,
        defaultFullAuto,
        defaultCodexSandbox,
        defaultApprovalPolicy,
        defaultOcVariant,
        defaultOcAutoApprove,
        defaultApprovalMode,
        defaultGeminiSandbox,
        defaultYolo,
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
            sandbox: codexSandbox || undefined,
            approvalPolicy: approvalPolicy || undefined,
            fullAuto: fullAuto || undefined,
        }),
        [model, codexSandbox, approvalPolicy, fullAuto],
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

    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "claude") return buildClaudeOptions();
        if (agentType === "codex") return buildCodexOptions();
        if (agentType === "opencode") return buildOpenCodeOptions();
        if (agentType === "gemini") return buildGeminiOptions();
        if (agentType === "cursor") return buildCursorOptions();
        return { type: "codex" };
    }, [
        agentType,
        buildClaudeOptions,
        buildCodexOptions,
        buildOpenCodeOptions,
        buildGeminiOptions,
        buildCursorOptions,
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
                    sandbox={codexSandbox}
                    approvalPolicy={approvalPolicy}
                    fullAuto={fullAuto}
                    onModelChange={setModel}
                    onSandboxChange={(v) => setCodexSandbox(v as CodexSandboxMode)}
                    onApprovalPolicyChange={(v) => setApprovalPolicy(v as CodexApprovalPolicy)}
                    onFullAutoChange={setFullAuto}
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
