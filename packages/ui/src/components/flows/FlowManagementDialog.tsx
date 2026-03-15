import { useState, useEffect, useCallback, useMemo } from "react";
import type { FlowDefinition, ActionDefinition } from "@taskflow/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    const selectedAction =
        tab === "actions" ? (actions.find((s) => s.id === selectedId) ?? null) : null;

    const referencingFlowsByActionId = useMemo(
        () =>
            new Map(
                actions.map((action) => [
                    action.id,
                    flows.filter((flow) =>
                        flow.actions.some(
                            (entry) => "actionId" in entry && entry.actionId === action.id,
                        ),
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
            <DialogContent className="w-6xl max-w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)]">
                <DialogHeader>
                    <DialogTitle>Flows & Actions</DialogTitle>
                </DialogHeader>

                <div className="flex h-[60vh] flex-1">
                    {/* Left column: navigation tabs */}
                    <nav className="border-border w-40 shrink-0 space-y-1 border-r py-2 pr-2">
                        <button
                            onClick={() => switchTab("flows")}
                            className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                tab === "flows"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                        >
                            Flows
                        </button>
                        <button
                            onClick={() => switchTab("actions")}
                            className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                tab === "actions"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                        >
                            Actions
                        </button>
                    </nav>

                    {/* Middle column: item list */}
                    <div className="border-border flex w-56 shrink-0 flex-col border-r">
                        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
                            {tab === "flows" &&
                                flows.map((f) => (
                                    <button
                                        key={f.id}
                                        onClick={() => selectItem(f.id)}
                                        className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                            selectedId === f.id
                                                ? "bg-accent text-accent-foreground"
                                                : "hover:bg-muted"
                                        }`}
                                    >
                                        <div className="font-medium">{f.name}</div>
                                        <div className="text-muted-foreground mt-0.5 text-xs">
                                            {f.actions.length} action
                                            {f.actions.length !== 1 ? "s" : ""}
                                        </div>
                                    </button>
                                ))}
                            {tab === "flows" && flows.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No flows yet
                                </div>
                            )}
                            {tab === "actions" &&
                                actions.map((s) => (
                                    <button
                                        key={s.id}
                                        onClick={() => selectItem(s.id)}
                                        className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                            selectedId === s.id
                                                ? "bg-accent text-accent-foreground"
                                                : "hover:bg-muted"
                                        }`}
                                    >
                                        <div className="font-medium">{s.name}</div>
                                        <div className="text-muted-foreground mt-0.5 text-xs">
                                            {s.sessionType}
                                        </div>
                                    </button>
                                ))}
                            {tab === "actions" && actions.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No actions yet
                                </div>
                            )}
                        </div>
                        <div className="flex items-center justify-end px-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={startCreating}
                                title={tab === "flows" ? "New flow" : "New action"}
                            >
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Right column: editor */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
                                    (referencingFlowsByActionId.get(selectedAction.id)?.length ??
                                        0) > 0
                                }
                                deleteDisabledReason={
                                    selectedAction &&
                                    (referencingFlowsByActionId.get(selectedAction.id)?.length ??
                                        0) > 0
                                        ? `Used by ${
                                              referencingFlowsByActionId
                                                  .get(selectedAction.id)
                                                  ?.map((f) => f.name)
                                                  .join(", ") ?? ""
                                          }`
                                        : undefined
                                }
                            />
                        )}
                        {!creating && !selectedFlow && !selectedAction && (
                            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                                Select an item or click <Plus className="mx-1 inline h-4 w-4" /> to
                                create
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { FlowManagementDialog };
