import type { SessionRef } from "./task";

export interface LinkedProject {
    projectId: string;
    note: string;
}

export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    createdAt: string;
    defaultInitCommand?: string;
    prompt?: string;
    linkedProjects?: LinkedProject[];
    hidden?: boolean;
    locationValid?: boolean;
}
