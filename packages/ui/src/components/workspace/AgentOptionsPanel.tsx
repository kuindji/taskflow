import { useState, useEffect, useRef, useCallback } from "react";
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
import { Play } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

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
    const defaultFullAccess =
        matchingValue?.fullAccess ??
        (agentType === "claude"
            ? (claudeSettings?.fullAccess ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.fullAccess ?? false)
              : agentType === "gemini"
                ? (geminiSettings?.fullAccess ?? false)
                : agentType === "cursor"
                  ? (cursorSettings?.fullAccess ?? false)
                  : (codexSettings?.fullAccess ?? false));
    const defaultDontAskQuestions =
        matchingValue?.dontAskQuestions ??
        (agentType === "claude"
            ? (claudeSettings?.dontAskQuestions ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.dontAskQuestions ?? false)
              : agentType === "gemini"
                ? (geminiSettings?.dontAskQuestions ?? false)
                : agentType === "cursor"
                  ? (cursorSettings?.dontAskQuestions ?? false)
                  : (codexSettings?.dontAskQuestions ?? false));
    const defaultModel =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
            : agentType === "opencode" && matchingValue?.type === "opencode"
              ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
              : agentType === "gemini" && matchingValue?.type === "gemini"
                ? (matchingValue.model ?? geminiSettings?.defaultModel ?? "default")
                : agentType === "cursor" && matchingValue?.type === "cursor"
                  ? (matchingValue.model ?? cursorSettings?.defaultModel ?? "default")
                  : agentType === "claude"
                    ? (claudeSettings?.defaultModel ?? "default")
                    : agentType === "opencode"
                      ? (opencodeSettings?.defaultModel ?? "")
                      : agentType === "gemini"
                        ? (geminiSettings?.defaultModel ?? "default")
                        : agentType === "cursor"
                          ? (cursorSettings?.defaultModel ?? "default")
                          : "default";

    const [fullAccess, setFullAccess] = useState(defaultFullAccess);
    const [dontAskQuestions, setDontAskQuestions] = useState(defaultDontAskQuestions);
    const [model, setModel] = useState<string>(defaultModel);

    const isFirstRender = useRef(true);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        setFullAccess(defaultFullAccess);
        setDontAskQuestions(defaultDontAskQuestions);
        if (
            agentType === "claude" ||
            agentType === "opencode" ||
            agentType === "gemini" ||
            agentType === "cursor"
        ) {
            setModel(defaultModel);
        }
    }, [agentType, defaultFullAccess, defaultDontAskQuestions, defaultModel]);

    const emitChange = useCallback(() => {
        const cb = onChangeRef.current;
        if (!cb) return;
        if (agentType === "claude") {
            cb({
                type: "claude",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            cb({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model || undefined,
            });
        } else if (agentType === "gemini") {
            cb({
                type: "gemini",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model:
                    model === "default"
                        ? undefined
                        : (model as "auto" | "pro" | "flash" | "flash-lite"),
            });
        } else if (agentType === "cursor") {
            cb({
                type: "cursor",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : model,
            });
        } else {
            cb({
                type: "codex",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
            });
        }
    }, [agentType, fullAccess, dontAskQuestions, model]);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            if (!emitOnMount) return;
        }
        emitChange();
    }, [emitOnMount, emitChange]);

    const handleRun = useCallback(() => {
        if (!onRun) return;
        if (agentType === "claude") {
            onRun({
                type: "claude",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            onRun({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model || undefined,
            });
        } else if (agentType === "gemini") {
            onRun({
                type: "gemini",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model:
                    model === "default"
                        ? undefined
                        : (model as "auto" | "pro" | "flash" | "flash-lite"),
            });
        } else if (agentType === "cursor") {
            onRun({
                type: "cursor",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
                model: model === "default" ? undefined : model,
            });
        } else {
            onRun({
                type: "codex",
                fullAccess: fullAccess || undefined,
                dontAskQuestions: dontAskQuestions || undefined,
            });
        }
    }, [agentType, fullAccess, dontAskQuestions, model, onRun]);

    return (
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
                <div className="flex flex-col gap-1">
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
                <Button size="sm" className="w-full" onClick={handleRun}>
                    <Play className="mr-1 h-3 w-3" />
                    Run
                </Button>
            )}
        </div>
    );
}

export { AgentOptionsPanel };
