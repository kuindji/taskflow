import type { Task, Project, SessionRef } from "@taskflow/shared";

function filterSessions(sessions: SessionRef[], instanceId: string): SessionRef[] {
    return sessions.filter((s) => s.instance === instanceId);
}

function filterTaskSessions(task: Task, instanceId: string): Task {
    return { ...task, sessions: filterSessions(task.sessions, instanceId) };
}

function filterProjectSessions(project: Project, instanceId: string): Project {
    return { ...project, sessions: filterSessions(project.sessions, instanceId) };
}

export { filterTaskSessions, filterProjectSessions };
