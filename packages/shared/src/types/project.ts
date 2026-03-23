import type { SessionRef } from "./task";

export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    createdAt: string;
    defaultInitCommand?: string;
    hidden?: boolean;
    locationValid?: boolean;
}
