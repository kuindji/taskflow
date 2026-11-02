import { useMemo } from "react";
import type { AttributeLayer, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";

/**
 * The layers below a task's own attributes: its project, then its parent.
 * An archived subtask's parent may be archived too, so the archive is searched
 * as well as the live list.
 */
function useInheritedAttributeLayers(task: Scoped<Task> | null): AttributeLayer[] {
    const parentId = task?.parentId;
    const parentTask = useTaskStore((s) =>
        parentId
            ? (s.tasks.find((t) => t.id === parentId) ??
              s.archivedTasks.find((t) => t.id === parentId))
            : undefined,
    );
    const taskProject = useProjectStore((s) =>
        task ? s.projects.find((p) => p.id === task.projectId) : undefined,
    );
    return useMemo<AttributeLayer[]>(() => {
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: taskProject?.attributes ?? [] },
        ];
        if (parentId) {
            layers.push({ scope: "parent", attributes: parentTask?.attributes ?? [] });
        }
        return layers;
    }, [parentTask, parentId, taskProject]);
}

export { useInheritedAttributeLayers };
