import { useState, useEffect, useCallback, useMemo } from "react";
import type { FlowDefinition, StepDefinition } from "@taskflow/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useFlowStore } from "@/stores/flow-store";
import { FlowEditor } from "./FlowEditor";
import { StepEditor } from "./StepEditor";

function FlowManagementDialog() {
    const open = useUIStore((s) => s.flowManagementOpen);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);

    const flows = useFlowStore((s) => s.flows);
    const steps = useFlowStore((s) => s.steps);

    const [tab, setTab] = useState<"flows" | "steps">("flows");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!open) return;
        const { fetchFlows, fetchSteps } = useFlowStore.getState();
        void fetchFlows();
        void fetchSteps();
    }, [open]);

    const selectedFlow = tab === "flows" ? (flows.find((f) => f.id === selectedId) ?? null) : null;
    const selectedStep = tab === "steps" ? (steps.find((s) => s.id === selectedId) ?? null) : null;

    const referencingFlowsByStepId = useMemo(
        () =>
            new Map(
                steps.map((step) => [
                    step.id,
                    flows.filter((flow) =>
                        flow.steps.some((entry) => "stepId" in entry && entry.stepId === step.id),
                    ),
                ]),
            ),
        [flows, steps],
    );

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleFlowManagement();
        },
        [toggleFlowManagement],
    );

    const handleSaveFlow = useCallback(async (flow: FlowDefinition) => {
        await useFlowStore.getState().saveFlow(flow);
        setSelectedId(flow.id);
        setCreating(false);
    }, []);

    const handleSaveStep = useCallback(async (step: StepDefinition) => {
        await useFlowStore.getState().saveStep(step);
        setSelectedId(step.id);
        setCreating(false);
    }, []);

    const handleDeleteFlow = useCallback(async (flowId: string) => {
        await useFlowStore.getState().deleteFlow(flowId);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const handleDeleteStep = useCallback(async (stepId: string) => {
        await useFlowStore.getState().deleteStep(stepId);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const switchTab = useCallback((newTab: "flows" | "steps") => {
        setTab(newTab);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const startCreating = useCallback(() => {
        setSelectedId(null);
        setCreating(true);
    }, []);

    const selectItem = useCallback((id: string) => {
        setSelectedId(id);
        setCreating(false);
    }, []);

    const clearSelection = useCallback(() => {
        setCreating(false);
        setSelectedId(null);
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="flex h-[70vh] max-w-3xl p-0" showCloseButton={false}>
                {/* Left panel: list */}
                <div className="flex w-52 flex-col border-r">
                    <div className="flex items-center justify-between border-b p-2">
                        <div className="flex gap-1">
                            <Button
                                variant={tab === "flows" ? "default" : "ghost"}
                                size="sm"
                                onClick={() => switchTab("flows")}
                            >
                                Flows
                            </Button>
                            <Button
                                variant={tab === "steps" ? "default" : "ghost"}
                                size="sm"
                                onClick={() => switchTab("steps")}
                            >
                                Steps
                            </Button>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={startCreating}
                        >
                            <Plus className="h-4 w-4" />
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2">
                        {tab === "flows" &&
                            flows.map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() => selectItem(f.id)}
                                    className={`w-full rounded p-2 text-left text-sm ${
                                        selectedId === f.id
                                            ? "bg-accent"
                                            : "hover:bg-muted"
                                    }`}
                                >
                                    <div>{f.name}</div>
                                    <div className="text-muted-foreground text-xs">
                                        {f.steps.length} steps
                                    </div>
                                </button>
                            ))}
                        {tab === "steps" &&
                            steps.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => selectItem(s.id)}
                                    className={`w-full rounded p-2 text-left text-sm ${
                                        selectedId === s.id
                                            ? "bg-accent"
                                            : "hover:bg-muted"
                                    }`}
                                >
                                    <div>{s.name}</div>
                                    <div className="text-muted-foreground text-xs">
                                        {s.sessionType}
                                    </div>
                                </button>
                            ))}
                    </div>
                </div>

                {/* Right panel: editor */}
                <div className="flex-1 overflow-y-auto">
                    {tab === "flows" && (creating || selectedFlow) && (
                        <FlowEditor
                            key={creating ? "new-flow" : selectedFlow?.id}
                            flow={creating ? null : selectedFlow}
                            globalSteps={steps}
                            onSave={handleSaveFlow}
                            onCancel={clearSelection}
                        />
                    )}
                    {tab === "steps" && (creating || selectedStep) && (
                        <StepEditor
                            key={creating ? "new-step" : selectedStep?.id}
                            step={creating ? null : selectedStep}
                            onSave={handleSaveStep}
                            onCancel={clearSelection}
                            onDelete={
                                selectedStep
                                    ? () => void handleDeleteStep(selectedStep.id)
                                    : undefined
                            }
                            deleteDisabled={
                                !!selectedStep &&
                                (referencingFlowsByStepId.get(selectedStep.id)?.length ?? 0) > 0
                            }
                            deleteDisabledReason={
                                selectedStep &&
                                (referencingFlowsByStepId.get(selectedStep.id)?.length ?? 0) > 0
                                    ? `Used by ${referencingFlowsByStepId
                                          .get(selectedStep.id)!
                                          .map((f) => f.name)
                                          .join(", ")}`
                                    : undefined
                            }
                        />
                    )}
                    {!creating && !selectedFlow && !selectedStep && (
                        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                            Select an item or click + to create
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { FlowManagementDialog };
