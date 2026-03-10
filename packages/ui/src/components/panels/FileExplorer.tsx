import { useEffect, useMemo } from 'react';
import { useFileStore } from '@/stores/file-store';
import { useTaskStore } from '@/stores/task-store';
import { useProjectStore } from '@/stores/project-store';
import { useSessionStore } from '@/stores/session-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FileTree } from './FileTree';

function FileExplorer() {
  const {
    tree,
    treePath,
    gitStatus,
    gitStatusPath,
    fetchTree,
    fetchGitStatus,
    watchPath,
    unwatchPath,
    clearExplorerState,
  } = useFileStore();
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === s.activeTaskId));
  const project = useProjectStore((s) => s.projects.find((p) => p.id === task?.projectId));
  const { addTab, getTabs, setActiveTab } = useSessionStore();

  const workingDir = task?.worktree.enabled && task.worktree.path
    ? task.worktree.path
    : project?.path;

  useEffect(() => {
    if (!workingDir) {
      clearExplorerState();
      return;
    }

    void fetchTree(workingDir);
    void fetchGitStatus(workingDir);
    void watchPath(workingDir);

    return () => {
      void unwatchPath(workingDir);
    };
  }, [workingDir, clearExplorerState, fetchTree, fetchGitStatus, watchPath, unwatchPath]);

  const gitFiles = useMemo(() => {
    const map = new Map<string, string>();
    if (!workingDir || gitStatusPath !== workingDir) return map;
    gitStatus?.files.forEach((f) => {
      const absolutePath = f.absolutePath ?? (workingDir ? `${workingDir}/${f.path}` : f.path);
      map.set(absolutePath, f.status);
    });
    return map;
  }, [gitStatus, gitStatusPath, workingDir]);

  const handleFileClick = (path: string) => {
    if (!task) return;

    const existingTab = getTabs(task.id).find((tab) => tab.type === 'editor' && tab.filePath === path);
    if (existingTab) {
      setActiveTab(task.id, existingTab.id);
      return;
    }

    addTab(task.id, {
      id: crypto.randomUUID(),
      type: 'editor',
      label: path.split('/').pop() ?? path,
      filePath: path,
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-1.5 flex items-center">
        <span className="text-muted-foreground text-[9px] uppercase tracking-wider">
          Files
        </span>
      </div>
      <Separator />
      <ScrollArea className="flex-1 py-1">
        {tree && treePath === workingDir ? (
          <FileTree
            node={tree}
            gitFiles={gitFiles}
            onFileClick={handleFileClick}
          />
        ) : (
          <div className="p-2 text-muted-foreground text-[11px]">
            {workingDir ? 'Loading...' : 'Select a task'}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export { FileExplorer };
