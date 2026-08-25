import {
    MASTER_OWNER_ID,
    latestArtifactsByType as collapseArtifacts,
} from "@taskflow/shared";
import type {
    ActionDefinition,
    FlowActionEntry,
    FlowArtifact,
    FlowDefinition,
} from "@taskflow/shared";
import type { SessionOwner } from "../sessions/owner";

function flowOwnerId(owner: SessionOwner): string {
    switch (owner.kind) {
        case "master":
            return MASTER_OWNER_ID;
        case "project":
            return owner.projectId;
        case "task":
            return owner.taskId;
    }
}

function ownerProjectId(owner: SessionOwner): string | null {
    return owner.kind === "master" ? null : owner.projectId;
}

function visibleDefinitions<T extends { projectId?: string }>(
    records: readonly T[],
    owner: SessionOwner,
): T[] {
    const projectId = ownerProjectId(owner);
    return records.filter(
        (record) => record.projectId === undefined || record.projectId === projectId,
    );
}

function actionLabel(entry: FlowActionEntry, actions: readonly ActionDefinition[]): string {
    if (entry.label?.trim()) return entry.label.trim();
    if (entry.inline) return entry.inline.name;
    return actions.find((action) => action.id === entry.actionId)?.name ?? entry.actionId;
}

function latestArtifactsByType(artifacts: readonly FlowArtifact[]): FlowArtifact[] {
    return collapseArtifacts([...artifacts]);
}

function stableSelectionIndex(
    items: readonly { id: string }[],
    selectedId: string | null,
    previousIndex = 0,
): number {
    if (items.length === 0) return -1;
    const retained = selectedId
        ? items.findIndex((item) => item.id === selectedId)
        : -1;
    if (retained >= 0) return retained;
    return Math.min(Math.max(previousIndex, 0), items.length - 1);
}

function flowName(runFlowId: string, flows: readonly FlowDefinition[]): string {
    return flows.find((flow) => flow.id === runFlowId)?.name ?? runFlowId;
}

export {
    actionLabel,
    flowName,
    flowOwnerId,
    latestArtifactsByType,
    ownerProjectId,
    stableSelectionIndex,
    visibleDefinitions,
};
