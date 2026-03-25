import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgentOptionsPanel } from "./AgentOptionsPanel";

interface AgentOptionsDialogProps {
    open: boolean;
    title: string;
    agentType: AgentType | null;
    onOpenChange: (open: boolean) => void;
    onRun: (agentType: AgentType, options: AgentLaunchOptions) => void;
}

function AgentOptionsDialog({
    open,
    title,
    agentType,
    onOpenChange,
    onRun,
}: AgentOptionsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                {agentType && (
                    <AgentOptionsPanel
                        key={agentType}
                        agentType={agentType}
                        onRun={(options) => {
                            onRun(agentType, options);
                            onOpenChange(false);
                        }}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

export { AgentOptionsDialog };
