import { useMemo } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { Task } from '@taskflow/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const taskCardVariants = cva(
  'px-2.5 py-1.5 mx-1.5 my-0.5 rounded cursor-pointer border-l-[3px]',
  {
    variants: {
      active: {
        true: 'bg-muted',
        false: 'bg-transparent hover:bg-muted/50',
      },
      status: {
        active: 'border-l-accent',
        archived: 'border-l-success',
        default: 'border-l-warning',
      },
    },
    defaultVariants: { active: false, status: 'default' },
  },
);

interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
  task: Task;
  isActive: boolean;
  onClick: () => void;
  className?: string;
}

export function TaskCard({ task, isActive, onClick, className }: TaskCardProps) {
  const status = task.status === 'archived' ? 'archived' : task.status === 'active' ? 'active' : 'default';

  const cardClasses = useMemo(
    () => cn(taskCardVariants({ active: isActive, status }), className),
    [isActive, status, className],
  );

  const titleClasses = useMemo(
    () => cn('text-xs', isActive ? 'text-foreground font-bold' : 'text-secondary-foreground'),
    [isActive],
  );

  return (
    <div onClick={onClick} className={cardClasses}>
      <div className={titleClasses}>
        {task.title}
      </div>
      {task.sessions.length > 0 && (
        <div className="flex gap-1.5 mt-0.5">
          {task.sessions.map((s) => (
            <Badge key={s.id} variant="outline" colorScheme={s.type === 'claude' ? 'claude' : 'codex'} className="text-[10px] px-1 py-0">
              {s.type}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
