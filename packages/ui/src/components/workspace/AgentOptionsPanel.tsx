import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
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
import { Play } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

interface AgentOptionsPanelProps {
    agentType: "claude" | "codex" | "opencode";
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

    const matchingValue = value?.type === agentType ? value : undefined;
    const defaultFullAccess =
        matchingValue?.fullAccess ??
        (agentType === "claude"
            ? (claudeSettings?.fullAccess ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.fullAccess ?? false)
              : (codexSettings?.fullAccess ?? false));
    const defaultModel =
        agentType === "claude" && matchingValue?.type === "claude"
            ? (matchingValue.model ?? "default")
            : agentType === "opencode" && matchingValue?.type === "opencode"
              ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
              : (claudeSettings?.defaultModel ?? "default");

    const [fullAccess, setFullAccess] = useState(defaultFullAccess);
    const [model, setModel] = useState<string>(defaultModel);

    const isFirstRender = useRef(true);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        setFullAccess(defaultFullAccess);
        if (agentType === "claude") {
            setModel(defaultModel);
        }
    }, [agentType, defaultFullAccess, defaultModel]);

    const emitChange = useCallback(() => {
        const cb = onChangeRef.current;
        if (!cb) return;
        if (agentType === "claude") {
            cb({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            cb({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                model: model || undefined,
            });
        } else {
            cb({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    }, [agentType, fullAccess, model]);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            if (!emitOnMount) return;
        }
        emitChange();
    }, [emitOnMount, emitChange]);

    const handleRun = () => {
        if (!onRun) return;
        if (agentType === "claude") {
            onRun({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            onRun({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                model: model || undefined,
            });
        } else {
            onRun({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
                <Switch
                    id="agent-full-access"
                    checked={fullAccess}
                    onCheckedChange={setFullAccess}
                />
                <Label htmlFor="agent-full-access" className="cursor-pointer text-xs">
                    Full access
                </Label>
            </div>

            {agentType === "claude" && (
                <>
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
                </>
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
