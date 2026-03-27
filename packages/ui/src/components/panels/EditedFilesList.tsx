import { useMemo } from "react";
import { FileCode } from "lucide-react";
import type { Task, TaskLogEntry } from "@taskflow/shared";
import { openFileInApp } from "@/lib/open-file";

interface EditedFilesListProps {
    files: TaskLogEntry[];
    workingDir: string;
    workspaceKey: string;
    task: Task;
}

function EditedFilesList({ files, workingDir, workspaceKey, task }: EditedFilesListProps) {
    const sorted = useMemo(
        () => [...files].sort((a, b) => a.message.localeCompare(b.message)),
        [files],
    );

    if (sorted.length === 0) return null;

    return (
        <div>
            <span className="text-muted-foreground text-xs font-medium">Edited Files</span>
            <div className="mt-2 space-y-0.5">
                {sorted.map((entry) => {
                    const absolutePath = `${workingDir}/${entry.message}`;
                    const filename = entry.message.split("/").pop() ?? entry.message;
                    const dir = entry.message.includes("/")
                        ? entry.message.slice(0, entry.message.lastIndexOf("/"))
                        : null;

                    return (
                        <button
                            key={entry.id}
                            type="button"
                            className="hover:bg-muted/50 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left"
                            onClick={() =>
                                void openFileInApp(absolutePath, workspaceKey, {
                                    taskId: task.id,
                                })
                            }>
                            <FileCode className="text-muted-foreground h-3 w-3 shrink-0" />
                            <span className="text-secondary-foreground truncate text-xs font-medium">
                                {filename}
                            </span>
                            {dir && (
                                <span className="text-muted-foreground ml-auto shrink-0 truncate text-[10px]">
                                    {dir}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export { EditedFilesList };
