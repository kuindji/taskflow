import { useEffect, useMemo } from 'react';
import type { Task } from '@taskflow/shared';
import { useProjectStore } from '@/stores/project-store';
import { useTaskStore } from '@/stores/task-store';
import { useWsStatus } from '@/providers/WebSocketProvider';
import { ProjectGroup } from './ProjectGroup';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Plus } from 'lucide-react';

export function TaskSidebar() {
  const { connected } = useWsStatus();
  const { projects, fetchProjects, addProject } = useProjectStore();
  const { tasks, activeTaskId, fetchTasks, setActiveTask, createTask } = useTaskStore();

  useEffect(() => {
    if (!connected) return;
    void fetchProjects();
    void fetchTasks();
  }, [connected, fetchProjects, fetchTasks]);

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
    const path = await window.taskflow?.selectProjectDirectory?.();
    if (!path) return null;
    const suggestedName = path.split('/').pop() ?? '';
    const input = window.prompt('Project name (optional)', suggestedName);
    const project = await addProject(input?.trim() || undefined, path);
    return project.id;
  };

  const handleNewTask = async () => {
    let projectId: string | undefined = activeTaskId ? tasks.find((t) => t.id === activeTaskId)?.projectId : projects[0]?.id;
    if (!projectId) { projectId = (await handleAddProject()) ?? undefined; if (!projectId) return; }
    const title = window.prompt('Task title');
    if (!title?.trim()) return;
    const task = await createTask(projectId, title.trim());
    setActiveTask(task.id);
  };

  return (
    <>
      <div className="p-2 border-b border-border flex gap-1">
        <Input placeholder="Search tasks..." className="flex-1 h-7 text-xs" />
        <Button variant="ghost" size="icon-sm" onClick={handleNewTask}><Plus className="h-3 w-3" /></Button>
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
    </>
  );
}
