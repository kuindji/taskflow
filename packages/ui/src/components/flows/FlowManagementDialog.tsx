import { useState, useEffect, useCallback, useMemo } from "react";
import type { FlowDefinition, ActionDefinition } from "@taskflow/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useFlowStore } from "@/stores/flow-store";
import { useProjectStore } from "@/stores/project-store";
import { FlowEditor } from "./FlowEditor";
import { ActionEditor } from "./ActionEditor";

function FlowManagementDialog() {
    const open = useUIStore((s) => s.flowManagementOpen);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);

    const flows = useFlowStore((s) => s.flows);
    const actions = useFlowStore((s) => s.actions);
    const projects = useProjectStore((s) => s.projects);
    const activeProjectId = useUIStore((s) => s.activeProjectId);

    const [tab, setTab] = useState<"flows" | "actions">("flows");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    // "all" = show everything, "global" = only global, otherwise a projectId
    const [projectFilter, setProjectFilter] = useState<string>(activeProjectId ?? "all");

    useEffect(() => {
        if (!open) return;
        const { fetchFlows, fetchActions } = useFlowStore.getState();
        void fetchFlows();
        void fetchActions();
    }, [open]);

    const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

    const filteredFlows = useMemo(() => {
        if (projectFilter === "all") return flows;
        if (projectFilter === "global") return flows.filter((f) => !f.projectId);
        return flows.filter((f) => f.projectId === projectFilter);
    }, [flows, projectFilter]);

    const filteredActions = useMemo(() => {
        if (projectFilter === "all") return actions;
        if (projectFilter === "global") return actions.filter((a) => !a.projectId);
        return actions.filter((a) => a.projectId === projectFilter);
    }, [actions, projectFilter]);

    const defaultProjectId =
        projectFilter !== "all" && projectFilter !== "global" ? projectFilter : undefined;

    const selectedFlow =
        tab === "flows" ? (filteredFlows.find((f) => f.id === selectedId) ?? null) : null;
    const selectedAction =
        tab === "actions" ? (filteredActions.find((s) => s.id === selectedId) ?? null) : null;

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
            <DialogContent
                className="bg-dialog-shell border-border w-4xl max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-1.5 sm:max-w-[calc(100vw-2rem)]"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Flows & Actions</DialogTitle>
                </DialogHeader>

                <div className="flex h-[60vh] gap-1.5">
                    {/* Left sidebar nav */}
                    <nav className="bg-card w-[148px] shrink-0 rounded-[10px] p-1.5">
                        <button
                            onClick={() => switchTab("flows")}
                            className={`mb-px block w-full rounded-md px-3 py-[7px] text-left text-[13px] transition-colors ${
                                tab === "flows"
                                    ? "bg-muted text-foreground font-medium"
                                    : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted/50"
                            }`}>
                            Flows
                        </button>
                        <button
                            onClick={() => switchTab("actions")}
                            className={`mb-px block w-full rounded-md px-3 py-[7px] text-left text-[13px] transition-colors ${
                                tab === "actions"
                                    ? "bg-muted text-foreground font-medium"
                                    : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted/50"
                            }`}>
                            Actions
                        </button>
                    </nav>

                    {/* Middle list column */}
                    <div className="bg-card flex w-[196px] shrink-0 flex-col rounded-[10px]">
                        <div className="p-2">
                            <Select
                                value={projectFilter}
                                onValueChange={(v) => {
                                    setProjectFilter(v);
                                    setSelectedId(null);
                                    setCreating(false);
                                }}>
                                <SelectTrigger className="h-7 w-full text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All</SelectItem>
                                    <SelectItem value="global">Global</SelectItem>
                                    {projects.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex-1 overflow-y-auto px-1.5 py-0.5">
                            {tab === "flows" &&
                                filteredFlows.map((f) => (
                                    <button
                                        key={f.id}
                                        onClick={() => selectItem(f.id)}
                                        className={`mb-0.5 w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                                            selectedId === f.id
                                                ? "bg-muted text-foreground font-medium"
                                                : "text-secondary-foreground hover:bg-muted/50"
                                        }`}>
                                        <div className="font-medium">{f.name}</div>
                                        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                                            <span>
                                                {f.actions.length} action
                                                {f.actions.length !== 1 ? "s" : ""}
                                            </span>
                                            {projectFilter === "all" && f.projectId && (
                                                <span className="bg-muted truncate rounded px-1">
                                                    {projectMap.get(f.projectId) ?? "Unknown"}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            {tab === "flows" && filteredFlows.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No flows yet
                                </div>
                            )}
                            {tab === "actions" &&
                                filteredActions.map((s) => (
                                    <button
                                        key={s.id}
                                        onClick={() => selectItem(s.id)}
                                        className={`mb-0.5 w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                                            selectedId === s.id
                                                ? "bg-muted text-foreground font-medium"
                                                : "text-secondary-foreground hover:bg-muted/50"
                                        }`}>
                                        <div className="font-medium">{s.name}</div>
                                        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                                            <span>{s.sessionType}</span>
                                            {projectFilter === "all" && s.projectId && (
                                                <span className="bg-muted truncate rounded px-1">
                                                    {projectMap.get(s.projectId) ?? "Unknown"}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            {tab === "actions" && filteredActions.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No actions yet
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end p-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={startCreating}
                                title={tab === "flows" ? "New flow" : "New action"}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Right editor column */}
                    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col rounded-[10px]">
                        {tab === "flows" && (creating || selectedFlow) && (
                            <FlowEditor
                                key={
                                    creating
                                        ? `new-flow-${defaultProjectId ?? "global"}`
                                        : selectedFlow?.id
                                }
                                flow={creating ? null : selectedFlow}
                                globalActions={actions}
                                defaultProjectId={defaultProjectId}
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
                                key={
                                    creating
                                        ? `new-action-${defaultProjectId ?? "global"}`
                                        : selectedAction?.id
                                }
                                action={creating ? null : selectedAction}
                                defaultProjectId={defaultProjectId}
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
