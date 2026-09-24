import { useCallback, useMemo, useState } from "react";
import type {
    AgentLaunchOptions,
    AgentType,
    BuiltinActionDefinition,
    BuiltinActionOverride,
} from "@taskflow/shared";
import {
    AGENT_DISPLAY_NAMES,
    ALL_AGENT_TYPES,
    builtinActionFollowsDefaultAgent,
    isAgentType,
    missingPromptVariables,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { useSettingsStore } from "@/stores/settings-store";
import { agentOptionsSnapshot } from "@/lib/normalize-agent-options";

const DEFAULT_AGENT_VALUE = "__default__";

interface BuiltinActionEditorProps {
    action: BuiltinActionDefinition;
    /** The machine the built-in belongs to; its default agent labels "Default agent". */
    backendId: string | null;
    onSave: (override: BuiltinActionOverride) => Promise<void>;
    onReset: () => Promise<void>;
    onCancel: () => void;
}

function snapshot(
    prompt: string,
    sessionType: AgentType | undefined,
    agentOptions: AgentLaunchOptions | undefined,
): string {
    return JSON.stringify({
        prompt,
        sessionType: sessionType ?? null,
        agentOptions: sessionType ? agentOptionsSnapshot(sessionType, agentOptions) : null,
    });
}

function BuiltinActionEditor({
    action,
    backendId,
    onSave,
    onReset,
    onCancel,
}: BuiltinActionEditorProps) {
    const defaultAgent = useSettingsStore(
        (s) => (backendId ? s.byBackend[backendId] : s.settings)?.general.defaultAgent ?? "claude",
    );
    const [prompt, setPrompt] = useState(action.prompt);
    const [sessionType, setSessionType] = useState<AgentType | undefined>(action.sessionType);
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(
        action.agentOptions,
    );
    const [optionsKey, setOptionsKey] = useState(0);
    const [confirmReset, setConfirmReset] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const missing = useMemo(
        () => missingPromptVariables(prompt, action.variables),
        [prompt, action.variables],
    );
    const initialSnapshot = useMemo(
        () => snapshot(action.prompt, action.sessionType, action.agentOptions),
        [action],
    );
    const hasChanges = initialSnapshot !== snapshot(prompt, sessionType, agentOptions);
    const canSave = hasChanges && prompt.trim() !== "" && missing.length === 0 && !busy;
    const followsDefault = builtinActionFollowsDefaultAgent(action.id);

    const handleAgentChange = useCallback((value: string) => {
        setSessionType(isAgentType(value) ? value : undefined);
        setAgentOptions(undefined);
        setOptionsKey((key) => key + 1);
    }, []);

    const handleResetOptions = useCallback(() => {
        setAgentOptions(undefined);
        setOptionsKey((key) => key + 1);
    }, []);

    const run = useCallback(async (work: () => Promise<void>) => {
        setError(null);
        setBusy(true);
        try {
            await work();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, []);

    const handleSave = useCallback(
        () =>
            run(() =>
                onSave({
                    id: action.id,
                    prompt,
                    sessionType,
                    agentOptions: sessionType ? agentOptions : undefined,
                    updatedAt: new Date().toISOString(),
                }),
            ),
        [run, onSave, action.id, prompt, sessionType, agentOptions],
    );

    const handleConfirmReset = useCallback(() => {
        setConfirmReset(false);
        void run(onReset);
    }, [run, onReset]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-5">
                <h3 className="text-base font-semibold">{action.name}</h3>
                <p className="text-muted-foreground mt-1 mb-5 text-sm">{action.description}</p>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="builtin-action-agent"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Agent
                        </Label>
                        <Select
                            value={sessionType ?? DEFAULT_AGENT_VALUE}
                            onValueChange={handleAgentChange}>
                            <SelectTrigger id="builtin-action-agent" size="sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {followsDefault && (
                                    <SelectItem value={DEFAULT_AGENT_VALUE}>
                                        {`Default agent (${AGENT_DISPLAY_NAMES[defaultAgent]})`}
                                    </SelectItem>
                                )}
                                {ALL_AGENT_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {AGENT_DISPLAY_NAMES[type]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="builtin-action-prompt"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Prompt
                        </Label>
                        <ExpandableTextarea
                            id="builtin-action-prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="min-h-[200px] text-sm"
                            dialogTitle={action.name}
                        />
                        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                            {action.variables.map((variable) => (
                                <li key={variable.name}>
                                    <code>{`{{${variable.name}}}`}</code> — {variable.description}
                                </li>
                            ))}
                        </ul>
                        {missing.length > 0 && (
                            <p className="text-destructive text-xs">
                                {`The prompt must include ${missing.map((name) => `{{${name}}}`).join(", ")}`}
                            </p>
                        )}
                    </div>

                    {sessionType && (
                        <div className="border-border rounded-md border p-3">
                            <AgentOptionsPanel
                                key={`${action.id}-${sessionType}-${optionsKey}`}
                                backendId={backendId ?? undefined}
                                agentType={sessionType}
                                value={agentOptions}
                                headless={action.mode === "headless"}
                                onChange={setAgentOptions}
                                onReset={handleResetOptions}
                            />
                        </div>
                    )}

                    {error && <p className="text-destructive text-sm">{error}</p>}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 px-6 py-3">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmReset(true)}
                    disabled={!action.isModified || busy}>
                    Reset to default
                </Button>
                <ConfirmDeleteDialog
                    open={confirmReset}
                    onOpenChange={setConfirmReset}
                    onConfirm={handleConfirmReset}
                    title="Reset this built-in action?"
                    description="Its prompt, agent and options go back to the defaults."
                    confirmLabel="Reset"
                />
                <div className="flex-1" />
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
                    Save
                </Button>
            </div>
        </div>
    );
}

export { BuiltinActionEditor };
