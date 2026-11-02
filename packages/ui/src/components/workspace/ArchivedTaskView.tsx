import type { Task } from "@taskflow/shared";
import { ArchiveRestore } from "lucide-react";
import type { Scoped } from "@/lib/backend-scope";
import { useInheritedAttributeLayers } from "@/hooks/useInheritedAttributeLayers";
import useIsElectron from "@/hooks/useIsElectron";
import { useTaskStore } from "@/stores/task-store";
import { AttributesSection } from "@/components/panels/AttributesSection";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Toolbar } from "@/components/ui/toolbar";
import { TruncatedText } from "@/components/ui/truncated-text";

function archivedLabel(archivedAt: string | null): string {
    if (archivedAt === null || Number.isNaN(Date.parse(archivedAt))) return "Archived";
    return `Archived ${new Date(archivedAt).toLocaleDateString()}`;
}

/**
 * An archived task, read-only: it has no sessions, tabs or git state, and the
 * backend refuses edits to it. Unarchive turns it back into a live workspace.
 */
function ArchivedTaskView({ task }: { task: Scoped<Task> }) {
    const isElectron = useIsElectron();
    const unarchiveTask = useTaskStore((s) => s.unarchiveTask);
    const inheritedLayers = useInheritedAttributeLayers(task);

    return (
        <>
            <Toolbar className={`gap-1.5 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
                <TruncatedText
                    tooltip
                    tooltipSide="bottom"
                    className="text-foreground ml-2 shrink text-sm font-semibold">
                    {task.title}
                </TruncatedText>
                <span className="text-muted-foreground shrink-0 text-xs">
                    {archivedLabel(task.archivedAt)}
                </span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void unarchiveTask(task)}
                    className="[-webkit-app-region:no-drag]">
                    <ArchiveRestore className="h-4 w-4" />
                    Unarchive
                </Button>
            </Toolbar>
            <div className="flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl space-y-4">
                    <div>
                        <label
                            htmlFor="archived-task-description"
                            className="text-muted-foreground text-xs font-medium">
                            Description
                        </label>
                        <Textarea
                            id="archived-task-description"
                            value={task.description}
                            readOnly
                            rows={4}
                            className="mt-1 text-sm"
                        />
                    </div>

                    <Separator className="my-4" />

                    <div>
                        <label
                            htmlFor="archived-task-notes"
                            className="text-muted-foreground text-xs font-medium">
                            Notes
                        </label>
                        <Textarea
                            id="archived-task-notes"
                            value={task.notes}
                            readOnly
                            rows={6}
                            className="mt-1 text-sm"
                        />
                    </div>

                    <Separator className="my-4" />

                    <AttributesSection
                        backendId={task.backendId}
                        owner={{ taskId: task.id }}
                        attributes={task.attributes}
                        inheritedLayers={inheritedLayers}
                        idPrefix="archived-task"
                        readOnly
                    />
                </div>
            </div>
        </>
    );
}

export { ArchivedTaskView };
