import type { Attribute } from "./attribute";
import type { SessionRef } from "./task";
import type { AccountAgentType } from "./agent";

export interface LinkedProject {
    projectId: string;
    note: string;
}

export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    attributes: Attribute[];
    createdAt: string;
    defaultInitCommand?: string;
    prompt?: string;
    linkedProjects?: LinkedProject[];
    hidden?: boolean;
    locationValid?: boolean;
    /** Per-agent account id, name, or "default". Absent key inherits the global default. */
    agentAccounts?: Partial<Record<AccountAgentType, string>>;
}
