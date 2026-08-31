import type { Project } from "@taskflow/shared";

function activeProjects(projects: readonly Project[]): Project[] {
    return projects.filter((project) => !project.hidden);
}

function selectableProjects(
    projects: readonly Project[],
    referencedProjectIds: Iterable<string> = [],
): Project[] {
    const referenced = new Set(referencedProjectIds);
    return projects.filter((project) => !project.hidden || referenced.has(project.id));
}

function selectableProjectId(
    projects: readonly Project[],
    preferredProjectId?: string,
): string | undefined {
    if (!preferredProjectId) return undefined;
    return projects.some((project) => project.id === preferredProjectId && !project.hidden)
        ? preferredProjectId
        : undefined;
}

export { activeProjects, selectableProjectId, selectableProjects };
