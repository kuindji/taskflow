import { useState, useEffect, useRef, useCallback } from "react";
import type {
    AgentLaunchOptions,
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Play } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { ClaudeOptions } from "@/components/shared/ClaudeOptions";
import { CodexOptions } from "@/components/shared/CodexOptions";

interface AgentOptionsPanelProps {
    agentType: AgentType;
    value?: AgentLaunchOptions;
    emitOnMount?: boolean;
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
}

function AgentOptionsPanel({
    agentType,
    value,
    emitOnMount = false,
    onRun,
    onChange,
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
    const defaultSandbox: CodexSandboxMode =
        matchingValue?.type === "codex"
            ? (matchingValue.sandbox ?? codexSettings?.sandbox ?? "workspace-write")
            : (codexSettings?.sandbox ?? "workspace-write");
    const defaultApprovalPolicy: CodexApprovalPolicy =
        matchingValue?.type === "codex"
            ? (matchingValue.approvalPolicy ?? codexSettings?.approvalPolicy ?? "on-request")
            : (codexSettings?.approvalPolicy ?? "on-request");

    // --- Generic defaults for non-Claude, non-Codex agents ---
    const defaultFullAccess =
        matchingValue &&
        matchingValue.type !== "claude" &&
        matchingValue.type !== "codex" &&
        "fullAccess" in matchingValue
            ? (matchingValue.fullAccess ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.fullAccess ?? false)
              : agentType === "gemini"
                ? (geminiSettings?.fullAccess ?? false)
                : agentType === "cursor"
                  ? (cursorSettings?.fullAccess ?? false)
                  : false;
    const defaultDontAskQuestions =
        matchingValue &&
        matchingValue.type !== "claude" &&
        matchingValue.type !== "codex" &&
        "dontAskQuestions" in matchingValue
            ? (matchingValue.dontAskQuestions ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.dontAskQuestions ?? false)
              : agentType === "gemini"
                ? (geminiSettings?.dontAskQuestions ?? false)
                : agentType === "cursor"
                  ? (cursorSettings?.dontAskQuestions ?? false)
                  : false;

    const defaultModel =
        agentType === "codex" && matchingValue?.type === "codex"
            ? (matchingValue.model ?? codexSettings?.defaultModel ?? "")
            : agentType === "claude" && matchingValue?.type === "claude"
              ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
              : agentType === "opencode" && matchingValue?.type === "opencode"
                ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
                : agentType === "gemini" && matchingValue?.type === "gemini"
                  ? (matchingValue.model ?? geminiSettings?.defaultModel ?? "default")
                  : agentType === "cursor" && matchingValue?.type === "cursor"
                    ? (matchingValue.model ?? cursorSettings?.defaultModel ?? "default")
                    : agentType === "codex"
                      ? (codexSettings?.defaultModel ?? "")
                      : agentType === "claude"
                        ? (claudeSettings?.defaultModel ?? "default")
                        : agentType === "opencode"
                          ? (opencodeSettings?.defaultModel ?? "")
                          : agentType === "gemini"
                            ? (geminiSettings?.defaultModel ?? "default")
                            : agentType === "cursor"
                              ? (cursorSettings?.defaultModel ?? "default")
                              : "default";

    // --- State ---
    const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(
        defaultDangerouslySkipPermissions,
    );
    const [permissionMode, setPermissionMode] = useState<string>(defaultPermissionMode);
    const [effort, setEffort] = useState<string>(defaultEffort);
    const [fullAccess, setFullAccess] = useState(defaultFullAccess);
    const [dontAskQuestions, setDontAskQuestions] = useState(defaultDontAskQuestions);
    const [fullAuto, setFullAuto] = useState(defaultFullAuto);
    const [sandbox, setSandbox] = useState<CodexSandboxMode>(defaultSandbox);
    const [approvalPolicy, setApprovalPolicy] =
        useState<CodexApprovalPolicy>(defaultApprovalPolicy);
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
            setSandbox(defaultSandbox);
            setApprovalPolicy(defaultApprovalPolicy);
            setModel(defaultModel);
        } else {
            setFullAccess(defaultFullAccess);
            setDontAskQuestions(defaultDontAskQuestions);
            if (agentType === "opencode" || agentType === "gemini" || agentType === "cursor") {
                setModel(defaultModel);
            }
        }
    }, [
        agentType,
        defaultDangerouslySkipPermissions,
        defaultPermissionMode,
        defaultEffort,
        defaultFullAccess,
        defaultDontAskQuestions,
        defaultFullAuto,
        defaultSandbox,
        defaultApprovalPolicy,
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
            sandbox: sandbox || undefined,
            approvalPolicy: approvalPolicy || undefined,
            fullAuto: fullAuto || undefined,
        }),
        [model, sandbox, approvalPolicy, fullAuto],
    );

    const buildGenericOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "opencode") {
            return {
                type: "opencode",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model || undefined,
            };
        }
        if (agentType === "gemini") {
            return {
                type: "gemini",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model:
                    model === "default"
                        ? undefined
                        : (model as "auto" | "pro" | "flash" | "flash-lite"),
            };
        }
        if (agentType === "cursor") {
            return {
                type: "cursor",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : model,
            };
        }
        // Should not reach here, but fallback
        return { type: "codex" };
    }, [agentType, fullAccess, dontAskQuestions, model]);

    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "claude") return buildClaudeOptions();
        if (agentType === "codex") return buildCodexOptions();
        return buildGenericOptions();
    }, [agentType, buildClaudeOptions, buildCodexOptions, buildGenericOptions]);

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
        <div className="flex flex-col">
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
                    sandbox={sandbox}
                    approvalPolicy={approvalPolicy}
                    fullAuto={fullAuto}
                    onModelChange={setModel}
                    onSandboxChange={(v) => setSandbox(v as CodexSandboxMode)}
                    onApprovalPolicyChange={(v) => setApprovalPolicy(v as CodexApprovalPolicy)}
                    onFullAutoChange={setFullAuto}
                />
            ) : (
                <div className="flex flex-col gap-3 p-3">
                    <div className="flex items-center gap-2">
                        <Switch
                            id="agent-full-access"
                            checked={fullAccess || dontAskQuestions}
                            onCheckedChange={setFullAccess}
                            disabled={dontAskQuestions}
                        />
                        <Label htmlFor="agent-full-access" className="cursor-pointer text-xs">
                            Full access
                        </Label>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="agent-dont-ask"
                            checked={dontAskQuestions}
                            onCheckedChange={setDontAskQuestions}
                        />
                        <Label htmlFor="agent-dont-ask" className="cursor-pointer text-xs">
                            Don&apos;t ask questions
                        </Label>
                    </div>
                </div>
            )}

            {agentType === "gemini" && (
                <div className="flex flex-col gap-1 px-3 pb-3">
                    <Label htmlFor="agent-model" className="text-xs">
                        Model
                    </Label>
                    <Select value={model} onValueChange={setModel}>
                        <SelectTrigger id="agent-model" className="h-7 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="flash">Flash</SelectItem>
                            <SelectItem value="flash-lite">Flash Lite</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            {agentType === "cursor" && (
                <div className="flex flex-col gap-1 px-3 pb-3">
                    <Label htmlFor="agent-model" className="text-xs">
                        Model
                    </Label>
                    <Input
                        id="agent-model"
                        className="h-7 text-xs"
                        value={model === "default" ? "" : model}
                        placeholder="default"
                        onChange={(e) => setModel(e.target.value || "default")}
                    />
                </div>
            )}

            {agentType === "opencode" && (
                <div className="flex flex-col gap-1 px-3 pb-3">
                    <Label htmlFor="agent-model" className="text-xs">
                        Model
                    </Label>
                    <input
                        id="agent-model"
                        type="text"
                        className="bg-input border-border h-7 rounded-md border px-2 text-xs"
                        placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                    />
                </div>
            )}

            {onRun && (
                <div className="pb-3">
                    <Button size="sm" className="w-full" onClick={handleRun}>
                        <Play className="mr-1 h-3 w-3" />
                        Run
                    </Button>
                </div>
            )}
        </div>
    );
}

export { AgentOptionsPanel };
