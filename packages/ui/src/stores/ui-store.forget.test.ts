import { beforeEach, describe, expect, it } from "bun:test";
import { useUIStore } from "./ui-store";

const split = { open: true, ratio: 0.5, activePane: "left" as const };

describe("forgetting a detached machine's records", () => {
    beforeEach(() => {
        useUIStore.setState({
            activeProjectId: null,
            sidebarFocusedItem: null,
            collapsedProjectIds: [],
            splitByWorkspace: {},
        });
    });

    it("clears the open project, focus, collapse and splits that referred to its records", () => {
        useUIStore.setState({
            activeProjectId: "pa",
            sidebarFocusedItem: { type: "task", id: "ta" },
            collapsedProjectIds: ["pa", "pb"],
            splitByWorkspace: {
                "project:pa": split,
                "task:ta": split,
                "project:pb": split,
                "task:tb": split,
                master: split,
            },
        });

        useUIStore
            .getState()
            .forgetRecords({ projectIds: new Set(["pa"]), taskIds: new Set(["ta"]) });

        const ui = useUIStore.getState();
        expect(ui.activeProjectId).toBeNull();
        expect(ui.sidebarFocusedItem).toBeNull();
        expect(ui.collapsedProjectIds).toEqual(["pb"]);
        expect(Object.keys(ui.splitByWorkspace).sort()).toEqual([
            "master",
            "project:pb",
            "task:tb",
        ]);
    });

    it("keeps references to another machine's records", () => {
        useUIStore.setState({
            activeProjectId: "pb",
            sidebarFocusedItem: { type: "project", id: "pb" },
        });

        useUIStore
            .getState()
            .forgetRecords({ projectIds: new Set(["pa"]), taskIds: new Set(["ta"]) });

        expect(useUIStore.getState().activeProjectId).toBe("pb");
        expect(useUIStore.getState().sidebarFocusedItem).toEqual({ type: "project", id: "pb" });
    });

    it("does not read a task id as a project id", () => {
        useUIStore.setState({ sidebarFocusedItem: { type: "project", id: "shared" } });
        useUIStore
            .getState()
            .forgetRecords({ projectIds: new Set(), taskIds: new Set(["shared"]) });
        expect(useUIStore.getState().sidebarFocusedItem).toEqual({ type: "project", id: "shared" });
    });
});
