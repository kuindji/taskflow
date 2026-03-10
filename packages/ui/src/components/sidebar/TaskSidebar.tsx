import { useEffect, useMemo, useState } from 'react';
import type { Task } from '@taskflow/shared';
import { useProjectStore } from '@/stores/project-store';
import { useTaskStore } from '@/stores/task-store';
import { useSessionStore } from '@/stores/session-store';
import { useWsStatus } from '@/providers/WebSocketProvider';
import { ProjectGroup } from './ProjectGroup';
import { NewTaskDialog } from './NewTaskDialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus } from 'lucide-react';

export function TaskSidebar() {
  const { connected } = useWsStatus();
  const { projects, fetchProjects, addProject } = useProjectStore();
  const { tasks, activeTaskId, fetchTasks, setActiveTask, createTask } = useTaskStore();
  const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  useEffect(() => {
    if (!connected) return;
    void fetchProjects();
    void fetchTasks();
  }, [connected, fetchProjects, fetchTasks]);

  useEffect(() => {
    syncWithTasks(tasks);
  }, [tasks, syncWithTasks]);

  const tasksByProject = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      const list = map.get(task.projectId) ?? [];
      list.push(task);
      map.set(task.projectId, list);
    }
    return map;
  }, [tasks]);

  // TODO: Replace window.prompt() with shadcn Dialog for consistent UX
  const handleAddProject = async (): Promise<string | null> => {
    let path: string | null | undefined;
    if (window.taskflow?.selectProjectDirectory) {
      path = await window.taskflow.selectProjectDirectory();
    } else {
      path = window.prompt('Project directory path');
    }
    if (!path) return null;
    const suggestedName = path.split('/').pop() ?? '';
    const input = window.prompt('Project name (optional)', suggestedName);
    const project = await addProject(input?.trim() || undefined, path);
    return project.id;
  };

  const handleNewTask = () => {
    if (projects.length === 0) {
      void handleAddProject().then((id) => {
        if (id) setNewTaskOpen(true);
      }).catch(() => {});
      return;
    }
    setNewTaskOpen(true);
  };

  const defaultProjectId = activeTaskId
    ? tasks.find((t) => t.id === activeTaskId)?.projectId ?? projects[0]?.id
    : projects[0]?.id;

  const handleCreateTask = async (data: {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
  }) => {
    try {
      const task = await createTask(data);
      setActiveTask(task.id);
    } catch (err) {
      console.error('Failed to create task:', err);
    }
  };

  return (
    <>
      <div className="p-2 border-b border-border flex">
        <Button variant="ghost" size="sm" onClick={handleNewTask} className="text-muted-foreground text-[11px] gap-1"><Plus className="h-3 w-3" />New Task</Button>
      </div>
      <ScrollArea className="flex-1 py-1">
        {projects.length === 0 && (
          <div className="p-3 text-muted-foreground text-[11px]">
            <div className="mb-2">No projects yet.</div>
            <Button variant="ghost" size="sm" onClick={handleAddProject} className="text-accent text-[11px]">Add Project</Button>
          </div>
        )}
        {projects.map((project) => (
          <ProjectGroup key={project.id} project={project} tasks={tasksByProject.get(project.id) ?? []} activeTaskId={activeTaskId} onTaskClick={setActiveTask} />
        ))}
      </ScrollArea>
      <Separator />
      <div className="px-2.5 py-1.5 flex justify-between">
        <Button variant="ghost" size="sm" onClick={handleAddProject} className="text-muted-foreground text-[11px]">Add Project</Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground text-[11px]">Settings</Button>
      </div>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projects={projects}
        defaultProjectId={defaultProjectId}
        onSubmit={(data) => void handleCreateTask(data)}
      />
    </>
  );
}
