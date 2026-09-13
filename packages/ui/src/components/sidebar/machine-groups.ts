import type { Project } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import type { MachineState } from "@/stores/backend-store";

interface MachineGroup {
    machine: MachineState;
    projects: Scoped<Project>[];
}

interface SidebarGroups {
    /** This machine's projects, plus any whose machine has no row (the dev renderer's). */
    local: Scoped<Project>[];
    /** One group per remote machine the user keeps attached, in row order. */
    remote: MachineGroup[];
}

function groupProjectsByMachine(
    projects: readonly Scoped<Project>[],
    machines: readonly MachineState[],
): SidebarGroups {
    const remote = machines
        .filter((machine) => !machine.isLocal && machine.keepAttached)
        .map((machine): MachineGroup => ({ machine, projects: [] }));
    const groupById = new Map(remote.map((group) => [group.machine.id, group]));
    const remoteIds = new Set(machines.filter((m) => !m.isLocal).map((m) => m.id));
    const local: Scoped<Project>[] = [];
    for (const project of projects) {
        const group = groupById.get(project.backendId);
        if (group) group.projects.push(project);
        // A detached machine's records are about to be reset; they have no section.
        else if (!remoteIds.has(project.backendId)) local.push(project);
    }
    return { local, remote };
}

/**
 * The projects the sidebar shows, top to bottom — what number badges count and
 * keyboard navigation walks. A section that is collapsed or not attached shows none.
 */
function shownProjects(
    groups: SidebarGroups,
    collapsedMachineIds: ReadonlySet<string>,
): Scoped<Project>[] {
    return [
        ...groups.local,
        ...groups.remote
            .filter(
                (group) =>
                    group.machine.state === "attached" &&
                    !collapsedMachineIds.has(group.machine.id),
            )
            .flatMap((group) => group.projects),
    ];
}

export { groupProjectsByMachine, shownProjects };
