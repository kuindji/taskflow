import { useCallback } from "react";
import {
    ACCOUNT_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    INHERIT_AGENT_ACCOUNT,
    type AccountAgentType,
    type Project,
    type ProjectAgentAccountsPatch,
} from "@taskflow/shared";
import { AgentAccountSelect } from "@/components/shared/AgentAccountSelect";
import { Separator } from "@/components/ui/separator";
import type { Scoped } from "@/lib/backend-scope";
import { useProjectStore } from "@/stores/project-store";
import { useSettingsStore } from "@/stores/settings-store";

interface ProjectAgentAccountsSectionProps {
    project: Scoped<Project>;
}

function ProjectAgentAccountsSection({ project }: ProjectAgentAccountsSectionProps) {
    // Accounts live in the settings of the machine that runs the project's agents.
    const settings = useSettingsStore((s) => s.byBackend[project.backendId] ?? null);
    const updateProject = useProjectStore((s) => s.updateProject);

    const handleChange = useCallback(
        (agent: AccountAgentType, value: string) => {
            const target = useProjectStore.getState().projects.find((p) => p.id === project.id);
            if (!target) return;
            const patch: ProjectAgentAccountsPatch = {};
            patch[agent] = value === INHERIT_AGENT_ACCOUNT ? null : value;
            void updateProject(target, { agentAccounts: patch });
        },
        [project.id, updateProject],
    );

    if (!settings) return null;
    const visible = ACCOUNT_AGENT_TYPES.filter(
        (agent) => settings[agent].accounts.length > 0 || project.agentAccounts?.[agent],
    );
    if (visible.length === 0) return null;

    return (
        <div className="flex flex-col gap-2">
            <Separator className="my-4" />
            <span className="text-muted-foreground text-xs font-medium">Agent accounts</span>
            {visible.map((agent) => (
                <AgentAccountSelect
                    key={agent}
                    label={AGENT_DISPLAY_NAMES[agent]}
                    hint={`Account ${AGENT_DISPLAY_NAMES[agent]} sessions in this project use`}
                    accounts={settings[agent].accounts}
                    value={project.agentAccounts?.[agent] ?? INHERIT_AGENT_ACCOUNT}
                    inheritLabel="Use global default"
                    onChange={(value) => handleChange(agent, value)}
                />
            ))}
        </div>
    );
}

export { ProjectAgentAccountsSection };
