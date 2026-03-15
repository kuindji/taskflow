import { useState, useEffect, useCallback, useMemo } from "react";
import type { FlowDefinition, ActionDefinition } from "@taskflow/shared";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useFlowStore } from "@/stores/flow-store";
import { FlowEditor } from "./FlowEditor";
import { ActionEditor } from "./ActionEditor";

function FlowManagementDialog() {
    const open = useUIStore((s) => s.flowManagementOpen);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);

    const flows = useFlowStore((s) => s.flows);
    const actions = useFlowStore((s) => s.actions);

    const [tab, setTab] = useState<"flows" | "actions">("flows");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!open) return;
        const { fetchFlows, fetchActions } = useFlowStore.getState();
        void fetchFlows();
        void fetchActions();
    }, [open]);

    const selectedFlow = tab === "flows" ? (flows.find((f) => f.id === selectedId) ?? null) : null;
    const selectedAction = tab === "actions" ? (actions.find((s) => s.id === selectedId) ?? null) : null;

    const referencingFlowsByActionId = useMemo(
        () =>
            new Map(
                actions.map((action) => [
                    action.id,
                    flows.filter((flow) =>
                        flow.actions.some((entry) => "actionId" in entry && entry.actionId === action.id),
                    ),
                ]),
            ),
        [flows, actions],
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

    const handleSaveAction = useCallback(async (action: ActionDefinition) => {
        await useFlowStore.getState().saveAction(action);
        setSelectedId(action.id);
        setCreating(false);
    }, []);

    const handleDeleteFlow = useCallback(async (flowId: string) => {
        await useFlowStore.getState().deleteFlow(flowId);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const handleDeleteAction = useCallback(async (actionId: string) => {
        await useFlowStore.getState().deleteAction(actionId);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const switchTab = useCallback((newTab: "flows" | "actions") => {
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
                                variant={tab === "actions" ? "default" : "ghost"}
                                size="sm"
                                onClick={() => switchTab("actions")}
                            >
                                Actions
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
                                        {f.actions.length} actions
                                    </div>
                                </button>
                            ))}
                        {tab === "actions" &&
                            actions.map((s) => (
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
                            globalActions={actions}
                            onSave={handleSaveFlow}
                            onCancel={clearSelection}
                            onDelete={
                                selectedFlow
                                    ? () => void handleDeleteFlow(selectedFlow.id)
                                    : undefined
                            }
                        />
                    )}
                    {tab === "actions" && (creating || selectedAction) && (
                        <ActionEditor
                            key={creating ? "new-action" : selectedAction?.id}
                            action={creating ? null : selectedAction}
                            onSave={handleSaveAction}
                            onCancel={clearSelection}
                            onDelete={
                                selectedAction
                                    ? () => void handleDeleteAction(selectedAction.id)
                                    : undefined
                            }
                            deleteDisabled={
                                !!selectedAction &&
                                (referencingFlowsByActionId.get(selectedAction.id)?.length ?? 0) > 0
                            }
                            deleteDisabledReason={
                                selectedAction &&
                                (referencingFlowsByActionId.get(selectedAction.id)?.length ?? 0) > 0
                                    ? `Used by ${(referencingFlowsByActionId
                                          .get(selectedAction.id)
                                          ?.map((f) => f.name)
                                          .join(", ")) ?? ""}`
                                    : undefined
                            }
                        />
                    )}
                    {!creating && !selectedFlow && !selectedAction && (
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
