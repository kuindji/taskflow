import { PiOptions } from "@/components/shared/PiOptions";
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
    return (
        <PiOptions
            mode="defaults"
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
