import { PiOptions } from "@/components/shared/PiOptions";
import { useBackendStore } from "@/stores/backend-store";
import type { PiThinkingLevel } from "@taskflow/shared";

interface PiSectionProps {
    defaultModel: string;
    thinking: PiThinkingLevel;
    tools: string;
    onModelChange: (value: string) => void;
    onThinkingChange: (value: PiThinkingLevel) => void;
    onToolsChange: (value: string) => void;
}

function PiSection({
    defaultModel,
    thinking,
    tools,
    onModelChange,
    onThinkingChange,
    onToolsChange,
}: PiSectionProps) {
    // Settings are primary's, so its Pi CLI lists the models.
    const primaryId = useBackendStore((s) => s.primaryId);
    return (
        <PiOptions
            mode="defaults"
            backendId={primaryId}
            modelValue={defaultModel}
            thinkingValue={thinking}
            toolsValue={tools}
            onModelChange={onModelChange}
            onThinkingChange={onThinkingChange}
            onToolsChange={onToolsChange}
        />
    );
}

export { PiSection };
