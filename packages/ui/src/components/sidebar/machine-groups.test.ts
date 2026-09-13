import { describe, expect, test } from "bun:test";
import type { Project } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import type { MachineState } from "@/stores/backend-store";
import { groupProjectsByMachine, shownProjects } from "./machine-groups";

function machine(id: string, changes: Partial<MachineState> = {}): MachineState {
    return {
        id,
        displayName: id,
        host: `${id}.lan`,
        instanceId: "main",
        state: "attached",
        isLocal: false,
        keepAttached: true,
        ...changes,
    };
}

function project(id: string, backendId: string): Scoped<Project> {
    return { id, backendId } as Scoped<Project>;
}

const ids = (list: readonly { id: string }[]) => list.map((p) => p.id);

describe("groupProjectsByMachine", () => {
    test("local projects come first whatever order the slices loaded in", () => {
        const machines = [machine("local", { isLocal: true }), machine("laptop")];
        const groups = groupProjectsByMachine(
            [project("l1", "laptop"), project("p1", "local"), project("l2", "laptop")],
            machines,
        );
        expect(ids(groups.local)).toEqual(["p1"]);
        expect(groups.remote.map((g) => [g.machine.id, ids(g.projects)])).toEqual([
            ["laptop", ["l1", "l2"]],
        ]);
        expect(ids(shownProjects(groups, new Set()))).toEqual(["p1", "l1", "l2"]);
    });

    test("a project whose machine has no row renders as local", () => {
        const groups = groupProjectsByMachine([project("p1", "dev")], []);
        expect(ids(groups.local)).toEqual(["p1"]);
        expect(groups.remote).toEqual([]);
    });

    test("a detached machine has no section and its projects are not shown", () => {
        const groups = groupProjectsByMachine(
            [project("l1", "laptop")],
            [machine("laptop", { state: "offline", keepAttached: false })],
        );
        expect(groups.local).toEqual([]);
        expect(groups.remote).toEqual([]);
    });

    test("an unreachable machine keeps its section but shows no projects", () => {
        const groups = groupProjectsByMachine(
            [project("l1", "laptop")],
            [machine("laptop", { state: "offline" })],
        );
        expect(groups.remote.map((g) => g.machine.id)).toEqual(["laptop"]);
        expect(shownProjects(groups, new Set())).toEqual([]);
    });

    test("a collapsed section's projects are not shown", () => {
        const groups = groupProjectsByMachine(
            [project("l1", "laptop"), project("d1", "desktop")],
            [machine("laptop"), machine("desktop")],
        );
        expect(ids(shownProjects(groups, new Set(["laptop"])))).toEqual(["d1"]);
    });
});
