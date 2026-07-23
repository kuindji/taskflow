import { useMemo } from "react";
import type { AttributeLayer } from "@taskflow/shared";
import { resolveWikiRoot } from "@taskflow/shared";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useTaskStore } from "@/stores/task-store";

/**
 * Absolute wiki root for the active workspace, or null when the workspace has
 * no `wiki` attribute. Mirrors the layering TaskInfoPanel builds for the
 * attributes editor: project, then parent task, then the task itself.
 */
function useWikiRoot(): string | null {
    const workspace = useActiveWorkspace();
    const task = workspace.task;
    const project = workspace.project;
    const parentTask = useTaskStore((s) =>
        task?.parentId ? s.tasks.find((t) => t.id === task.parentId) : undefined,
    );

    return useMemo(() => {
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: project?.attributes ?? [] },
        ];
        if (task?.parentId) {
            layers.push({ scope: "parent", attributes: parentTask?.attributes ?? [] });
        }
        if (task) layers.push({ scope: "task", attributes: task.attributes });
        return resolveWikiRoot({ layers, workingDir: workspace.workingDir });
    }, [parentTask, project, task, workspace.workingDir]);
}

export { useWikiRoot };
