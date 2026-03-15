import { useState, useEffect, useRef } from "react";
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
import { Play } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

interface AgentOptionsPanelProps {
    agentType: AgentType;
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
}

function AgentOptionsPanel({ agentType, onRun, onChange }: AgentOptionsPanelProps) {
    const claudeSettings = useSettingsStore((s) => s.settings?.claude);
    const codexSettings = useSettingsStore((s) => s.settings?.codex);
    const geminiSettings = useSettingsStore((s) => s.settings?.gemini);

    const defaultFullAccess =
        agentType === "claude"
            ? (claudeSettings?.fullAccess ?? false)
            : agentType === "gemini"
              ? (geminiSettings?.fullAccess ?? false)
              : (codexSettings?.fullAccess ?? false);
    const defaultModel =
        agentType === "claude"
            ? (claudeSettings?.defaultModel ?? "default")
            : agentType === "gemini"
              ? (geminiSettings?.defaultModel ?? "default")
              : "default";

    const [fullAccess, setFullAccess] = useState(defaultFullAccess);
    const [model, setModel] = useState<string>(defaultModel);

    const isFirstRender = useRef(true);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (!onChange) return;
        if (agentType === "claude") {
            onChange({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "gemini") {
            onChange({
                type: "gemini",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "auto" | "pro" | "flash" | "flash-lite"),
            });
        } else {
            onChange({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    }, [agentType, fullAccess, model, onChange]);

    const handleRun = () => {
        if (!onRun) return;
        if (agentType === "claude") {
            onRun({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "gemini") {
            onRun({
                type: "gemini",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "auto" | "pro" | "flash" | "flash-lite"),
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
