import { useState } from 'react';
import type { Project, Task } from '@taskflow/shared';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { TaskCard } from './TaskCard';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface ProjectGroupProps {
  project: Project;
  tasks: Task[];
  activeTaskId: string | null;
  onTaskClick: (taskId: string) => void;
}

export function ProjectGroup({ project, tasks, activeTaskId, onTaskClick }: ProjectGroupProps) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full px-2.5 py-1 flex justify-between items-center cursor-pointer select-none hover:bg-muted/50 transition-colors">
        <span className="text-muted-foreground text-[9px] uppercase flex items-center gap-1">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {project.name}
        </span>
        <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{tasks.length}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} isActive={task.id === activeTaskId} onClick={() => onTaskClick(task.id)} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
