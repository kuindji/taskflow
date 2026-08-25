import { describe, expect, it } from "bun:test";
import type { ActionDefinition, FlowArtifact, FlowDefinition } from "@taskflow/shared";
import {
    actionLabel,
    flowName,
    flowOwnerId,
    latestArtifactsByType,
    ownerProjectId,
    stableSelectionIndex,
    visibleDefinitions,
} from "./model";

const timestamp = "2026-08-25T00:00:00.000Z";

function action(id: string, projectId?: string): ActionDefinition {
    return {
        id,
        projectId,
        name: `Action ${id}`,
        prompt: "echo ok",
        sessionType: "shell",
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function flow(id: string, projectId?: string): FlowDefinition {
    return {
        id,
        projectId,
        name: `Flow ${id}`,
        description: "",
        actions: [{ id: "entry", actionId: "global" }],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

describe("flow models", () => {
    it("maps session owners to backend flow owner IDs and project scope", () => {
        expect(flowOwnerId({ kind: "master" })).toBe("__master__");
        expect(flowOwnerId({ kind: "project", projectId: "p1" })).toBe("p1");
        expect(flowOwnerId({ kind: "task", taskId: "t1", projectId: "p1" })).toBe("t1");
        expect(ownerProjectId({ kind: "master" })).toBeNull();
        expect(ownerProjectId({ kind: "task", taskId: "t1", projectId: "p1" })).toBe("p1");
    });

    it("shows only global definitions at master and global plus project definitions elsewhere", () => {
        const records = [flow("global"), flow("p1", "p1"), flow("p2", "p2")];
        expect(visibleDefinitions(records, { kind: "master" }).map((item) => item.id)).toEqual([
            "global",
        ]);
        expect(
            visibleDefinitions(records, { kind: "project", projectId: "p1" }).map(
                (item) => item.id,
            ),
        ).toEqual(["global", "p1"]);
        expect(
            visibleDefinitions(records, {
                kind: "task",
                taskId: "t1",
                projectId: "p1",
            }).map((item) => item.id),
        ).toEqual(["global", "p1"]);
    });

    it("resolves explicit, inline, referenced, and missing action labels", () => {
        const actions = [action("global")];
        expect(actionLabel({ id: "1", label: "Override", actionId: "global" }, actions)).toBe(
            "Override",
        );
        expect(
            actionLabel(
                {
                    id: "2",
                    inline: { name: "Inline", prompt: "pwd", sessionType: "shell" },
                },
                actions,
            ),
        ).toBe("Inline");
        expect(actionLabel({ id: "3", actionId: "global" }, actions)).toBe("Action global");
        expect(actionLabel({ id: "4", actionId: "missing" }, actions)).toBe("missing");
    });

    it("collapses artifacts by latest type and preserves a stable selection", () => {
        const artifacts: FlowArtifact[] = [
            { type: "result", text: "old", actionEntryId: "a", createdAt: "2026-01-01" },
            { type: "log", path: "/tmp/log", actionEntryId: "a", createdAt: "2026-01-03" },
            { type: "result", text: "new", actionEntryId: "b", createdAt: "2026-01-02" },
        ];
        expect(latestArtifactsByType(artifacts).map((item) => item.text ?? item.path)).toEqual([
            "/tmp/log",
            "new",
        ]);
        expect(stableSelectionIndex([{ id: "a" }, { id: "b" }], "b", 0)).toBe(1);
        expect(stableSelectionIndex([{ id: "a" }], "b", 1)).toBe(0);
        expect(stableSelectionIndex([], "b", 1)).toBe(-1);
        expect(flowName("global", [flow("global")])).toBe("Flow global");
        expect(flowName("missing", [])).toBe("missing");
    });
});
