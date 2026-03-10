import { useCallback, useEffect, useRef, useState } from 'react';
import { useTaskStore } from '@/stores/task-store';
import { useUIStore } from '@/stores/ui-store';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X } from 'lucide-react';

function TaskInfoPanel() {
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const { updateTask } = useTaskStore();
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const lastSavedRef = useRef({ description: '', notes: '' });
  const draftRef = useRef({ description: '', notes: '' });
  const taskId = task?.id ?? null;

  draftRef.current = {
    description: descriptionDraft,
    notes: notesDraft,
  };

  const persistDrafts = useCallback((targetTaskId: string, description: string, notes: string) => {
    const updates: { description?: string; notes?: string } = {};
    if (description !== lastSavedRef.current.description) {
      updates.description = description;
    }
    if (notes !== lastSavedRef.current.notes) {
      updates.notes = notes;
    }
    if (Object.keys(updates).length === 0) return;

    lastSavedRef.current = { description, notes };

    void updateTask(targetTaskId, updates).catch((err) => {
      console.error('Failed to update task:', err);
    });
  }, [updateTask]);

  useEffect(() => {
    if (!task) {
      setDescriptionDraft('');
      setNotesDraft('');
      lastSavedRef.current = { description: '', notes: '' };
      return;
    }

    setDescriptionDraft(task.description);
    setNotesDraft(task.notes);
    lastSavedRef.current = {
      description: task.description,
      notes: task.notes,
    };
  }, [taskId]);

  // Auto-save on debounce
  useEffect(() => {
    if (!taskId) return;
    if (
      descriptionDraft === lastSavedRef.current.description &&
      notesDraft === lastSavedRef.current.notes
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      persistDrafts(taskId, draftRef.current.description, draftRef.current.notes);
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [descriptionDraft, notesDraft, persistDrafts, taskId]);

  // Flush unsaved changes before switching tasks and on unmount.
  useEffect(() => {
    return () => {
      if (!taskId) return;
      persistDrafts(taskId, draftRef.current.description, draftRef.current.notes);
    };
  }, [persistDrafts, taskId]);

  if (!task) {
    return (
      <div className="p-2 text-muted-foreground text-[11px]">
        Select a task
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 flex justify-between items-center">
        <span className="text-muted-foreground text-[9px] uppercase tracking-wider">
          Task Info
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useUIStore.getState().toggleTaskInfo()}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Separator />

      <ScrollArea className="flex-1 p-2">
        <div className="space-y-3">
          {/* Description */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Description
            </label>
            <Textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              rows={4}
              className="mt-1 text-[11px]"
            />
          </div>

          <Separator className="my-3" />

          {/* Branch */}
          {task.worktree.branch && (
            <div>
              <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Branch
              </label>
              <div className="mt-1">
                <Badge variant="outline" colorScheme="active">
                  {task.worktree.branch}
                </Badge>
              </div>
            </div>
          )}

          {/* Worktree */}
          {task.worktree.path && (
            <div>
              <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
                Worktree
              </label>
              <div className="mt-1 text-secondary-foreground text-[11px]">
                {task.worktree.path}
              </div>
            </div>
          )}

          <Separator className="my-3" />

          {/* Created */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Created
            </label>
            <div className="mt-1 text-secondary-foreground text-[11px]">
              {new Date(task.createdAt).toLocaleString()}
            </div>
          </div>

          <Separator className="my-3" />

          {/* Notes */}
          <div>
            <label className="text-muted-foreground text-[9px] uppercase tracking-wider">
              Notes
            </label>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={6}
              placeholder="Add notes..."
              className="mt-1 text-[11px]"
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export { TaskInfoPanel };
