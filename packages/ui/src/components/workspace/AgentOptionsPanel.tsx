import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Play } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useOpenCodeModels, useOpenCodeAgents } from "@/hooks/useOpenCodeData";

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

    // Common defaults (for non-opencode agents)
    const defaultFullAccess =
        matchingValue?.type !== "opencode"
            ? (matchingValue?.fullAccess ??
              (agentType === "claude"
                  ? (claudeSettings?.fullAccess ?? false)
                  : agentType === "gemini"
                    ? (geminiSettings?.fullAccess ?? false)
                    : agentType === "cursor"
                      ? (cursorSettings?.fullAccess ?? false)
                      : (codexSettings?.fullAccess ?? false)))
            : false;
    const defaultDontAskQuestions =
        matchingValue?.type !== "opencode"
            ? (matchingValue?.dontAskQuestions ??
              (agentType === "claude"
                  ? (claudeSettings?.dontAskQuestions ?? false)
                  : agentType === "gemini"
                    ? (geminiSettings?.dontAskQuestions ?? false)
                    : agentType === "cursor"
                      ? (cursorSettings?.dontAskQuestions ?? false)
                      : (codexSettings?.dontAskQuestions ?? false)))
            : false;
    const defaultModel =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
            : agentType === "gemini" && matchingValue?.type === "gemini"
              ? (matchingValue.model ?? geminiSettings?.defaultModel ?? "default")
              : agentType === "cursor" && matchingValue?.type === "cursor"
                ? (matchingValue.model ?? cursorSettings?.defaultModel ?? "default")
                : agentType === "claude"
                  ? (claudeSettings?.defaultModel ?? "default")
                  : agentType === "gemini"
                    ? (geminiSettings?.defaultModel ?? "default")
                    : agentType === "cursor"
                      ? (cursorSettings?.defaultModel ?? "default")
                      : "default";

    // OpenCode-specific defaults
    const defaultOcModel =
        matchingValue?.type === "opencode"
            ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
            : (opencodeSettings?.defaultModel ?? "");
    const defaultOcAgent =
        matchingValue?.type === "opencode"
            ? (matchingValue.agent ?? opencodeSettings?.defaultAgent ?? "")
            : (opencodeSettings?.defaultAgent ?? "");
    const defaultOcVariant =
        matchingValue?.type === "opencode"
            ? (matchingValue.variant ?? opencodeSettings?.defaultVariant ?? "")
            : (opencodeSettings?.defaultVariant ?? "");
    const defaultOcAutoApprove =
        matchingValue?.type === "opencode"
            ? (matchingValue.autoApprove ?? opencodeSettings?.autoApprove ?? false)
            : (opencodeSettings?.autoApprove ?? false);

    // Common state
    const [fullAccess, setFullAccess] = useState(defaultFullAccess);
    const [dontAskQuestions, setDontAskQuestions] = useState(defaultDontAskQuestions);
    const [model, setModel] = useState<string>(defaultModel);

    // OpenCode state
    const [ocModel, setOcModel] = useState(defaultOcModel);
    const [ocAgent, setOcAgent] = useState(defaultOcAgent);
    const [ocVariant, setOcVariant] = useState(defaultOcVariant);
    const [ocAutoApprove, setOcAutoApprove] = useState(defaultOcAutoApprove);

    // OpenCode dynamic data
    const isOpenCode = agentType === "opencode";
    const ocModels = useOpenCodeModels(isOpenCode);
    const ocAgents = useOpenCodeAgents(isOpenCode);

    const ocModelOptions = useMemo(() => {
        if (!ocModels) return null;
        return ocModels.map((m) => ({ value: m.id, label: m.id }));
    }, [ocModels]);

    const ocAgentOptions = useMemo(() => {
        if (!ocAgents) return null;
        return ocAgents.map((a) => ({ value: a.name, label: `${a.name} (${a.kind})` }));
    }, [ocAgents]);

    const isFirstRender = useRef(true);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (agentType === "opencode") {
            setOcModel(defaultOcModel);
            setOcAgent(defaultOcAgent);
            setOcVariant(defaultOcVariant);
            setOcAutoApprove(defaultOcAutoApprove);
        } else {
            setFullAccess(defaultFullAccess);
            setDontAskQuestions(defaultDontAskQuestions);
            if (
                agentType === "claude" ||
                agentType === "gemini" ||
                agentType === "cursor"
            ) {
                setModel(defaultModel);
            }
        }
    }, [
        agentType,
        defaultFullAccess,
        defaultDontAskQuestions,
        defaultModel,
        defaultOcModel,
        defaultOcAgent,
        defaultOcVariant,
        defaultOcAutoApprove,
    ]);

    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "opencode") {
            return {
                type: "opencode",
                model: ocModel || undefined,
                agent: ocAgent || undefined,
                variant: ocVariant || undefined,
                autoApprove: ocAutoApprove || undefined,
            };
        }
        if (agentType === "claude") {
            return {
                type: "claude",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
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
        return {
            type: "codex",
            fullAccess: fullAccess || undefined,
            dontAskQuestions: dontAskQuestions || undefined,
        };
    }, [agentType, fullAccess, dontAskQuestions, model, ocModel, ocAgent, ocVariant, ocAutoApprove]);

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
        <div className="flex flex-col gap-3 p-3">
            {agentType !== "opencode" && (
                <>
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
                </>
            )}

            {agentType === "claude" && (
                <div className="flex flex-col gap-1">
                    <Label htmlFor="agent-model" className="text-xs">
                        Model
                    </Label>
                    <Select value={model} onValueChange={setModel}>
                        <SelectTrigger id="agent-model" className="h-7 text-xs">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">Default</SelectItem>
                            <SelectItem value="opus">Opus</SelectItem>
                            <SelectItem value="sonnet">Sonnet</SelectItem>
                            <SelectItem value="haiku">Haiku</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}

            {agentType === "gemini" && (
                <div className="flex flex-col gap-1">
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
                <div className="flex flex-col gap-1">
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
                <>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Model</Label>
                        <SearchableSelect
                            value={ocModel}
                            onChange={setOcModel}
                            options={ocModelOptions}
                            placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                            allowCustom
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Agent</Label>
                        <SearchableSelect
                            value={ocAgent}
                            onChange={setOcAgent}
                            options={ocAgentOptions}
                            placeholder="Default agent"
                            allowCustom
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label className="text-xs">Variant</Label>
                        <Select value={ocVariant || "none"} onValueChange={(v) => setOcVariant(v === "none" ? "" : v)}>
                            <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="max">Max</SelectItem>
                                <SelectItem value="minimal">Minimal</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="agent-auto-approve"
                            checked={ocAutoApprove}
                            onCheckedChange={setOcAutoApprove}
                        />
                        <Label htmlFor="agent-auto-approve" className="cursor-pointer text-xs">
                            Auto-approve permissions
                        </Label>
                    </div>
                </>
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
