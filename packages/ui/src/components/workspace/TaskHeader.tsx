import type { Task, Project } from '@taskflow/shared';
import { Badge } from '@/components/ui/badge';

interface TaskHeaderProps { task: Task; project: Project | undefined; }

export function TaskHeader({ task, project }: TaskHeaderProps) {
  return (
    <div className="px-3 py-1.5 border-b border-border flex items-center gap-2">
      <span className="text-foreground font-bold text-[13px]">{task.title}</span>
      <span className="text-muted-foreground text-[11px]">{project?.name}</span>
      {task.worktree?.branch && (
        <Badge variant="outline" className="text-[9px] px-1.5 py-0">{task.worktree.branch}</Badge>
      )}
    </div>
  );
}
