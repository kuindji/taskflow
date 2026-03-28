import type { ActionInline, SessionType, AgentLaunchOptions } from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";

interface InlineActionEditorProps {
    entryId: string;
    inline: ActionInline;
    onUpdate: (
        entryId: string,
        updates: Partial<{
            name: string;
            prompt: string;
            sessionType: SessionType;
            agentOptions: AgentLaunchOptions | undefined;
        }>,
    ) => void;
    onSessionTypeChange: (entryId: string, value: string) => void;
}

function InlineActionEditor({
    entryId,
    inline,
    onUpdate,
    onSessionTypeChange,
}: InlineActionEditorProps) {
    return (
        <div className="border-border mt-3 flex flex-col gap-2 border-t pt-3">
            <Input
                value={inline.name}
                onChange={(e) => onUpdate(entryId, { name: e.target.value })}
                placeholder="Inline action name"
            />
            <Select
                value={inline.sessionType}
                onValueChange={(value) => onSessionTypeChange(entryId, value)}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="claude">Claude</SelectItem>
                    <SelectItem value="codex">Codex</SelectItem>
                    <SelectItem value="opencode">OpenCode</SelectItem>
                    <SelectItem value="gemini">Gemini</SelectItem>
                    <SelectItem value="cursor">Cursor</SelectItem>
                    <SelectItem value="shell">Shell</SelectItem>
                </SelectContent>
            </Select>
            <ExpandableTextarea
                value={inline.prompt}
                onChange={(e) => onUpdate(entryId, { prompt: e.target.value })}
                placeholder="Inline action prompt"
                className="min-h-[120px] text-sm"
                dialogTitle="Inline Action Prompt"
            />
            {inline.sessionType !== "shell" && (
                <div className="border-border rounded-md border p-1">
                    <AgentOptionsPanel
                        key={`${entryId}-${inline.sessionType}`}
                        agentType={inline.sessionType}
                        value={inline.agentOptions}
                        emitOnMount
                        onChange={(options) => onUpdate(entryId, { agentOptions: options })}
                    />
                </div>
            )}
        </div>
    );
}

export { InlineActionEditor };
