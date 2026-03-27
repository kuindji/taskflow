import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LinkedProject, Project } from "@taskflow/shared";
import { Plus, X } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface LinkedProjectsSectionProps {
    project: Project;
}

function LinkedProjectsSection({ project }: LinkedProjectsSectionProps) {
    const projects = useProjectStore((s) => s.projects);
    const updateProject = useProjectStore((s) => s.updateProject);
    const linkedProjects = useMemo(() => project.linkedProjects ?? [], [project.linkedProjects]);

    // Keep a ref to avoid stale closures in debounced callbacks
    const linkedProjectsRef = useRef<LinkedProject[]>(linkedProjects);
    useEffect(() => {
        linkedProjectsRef.current = linkedProjects;
    }, [linkedProjects]);

    const linkedIds = useMemo(
        () => new Set(linkedProjects.map((lp) => lp.projectId)),
        [linkedProjects],
    );

    const availableProjects = useMemo(
        () =>
            projects
                .filter((p) => p.id !== project.id && !p.hidden && !linkedIds.has(p.id))
                .sort((a, b) => a.name.localeCompare(b.name)),
        [projects, project.id, linkedIds],
    );

    const resolvedNames = useMemo(() => {
        const map: Record<string, string> = {};
        for (const p of projects) {
            map[p.id] = p.name;
        }
        return map;
    }, [projects]);

    const [addPopoverOpen, setAddPopoverOpen] = useState(false);

    // Note drafts for debounced inline editing
    const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
    const lastSavedNotes = useRef<Record<string, string>>({});
    const noteDraftsRef = useRef<Record<string, string>>({});

    // Sync note drafts when linked projects change identity
    useEffect(() => {
        const initial: Record<string, string> = {};
        const saved: Record<string, string> = {};
        for (const lp of linkedProjects) {
            initial[lp.projectId] = lp.note;
            saved[lp.projectId] = lp.note;
        }
        setNoteDrafts(initial);
        lastSavedNotes.current = saved;
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only when project identity changes
    }, [project.id]);

    useEffect(() => {
        noteDraftsRef.current = noteDrafts;
    }, [noteDrafts]);

    const persistNotes = useCallback(
        (drafts: Record<string, string>) => {
            // Read from ref to avoid stale closure over linkedProjects
            const current = linkedProjectsRef.current;
            const updated = current.map((lp) => ({
                ...lp,
                note: drafts[lp.projectId] ?? lp.note,
            }));
            const hasChanges = updated.some(
                (lp) => lp.note !== (lastSavedNotes.current[lp.projectId] ?? ""),
            );
            if (!hasChanges) return;
            for (const lp of updated) {
                lastSavedNotes.current[lp.projectId] = lp.note;
            }
            void updateProject(project.id, { linkedProjects: updated });
        },
        [project.id, updateProject],
    );

    // Debounce note changes
    useEffect(() => {
        const hasChanges = Object.entries(noteDrafts).some(
            ([id, note]) => note !== (lastSavedNotes.current[id] ?? ""),
        );
        if (!hasChanges) return;

        const timeoutId = window.setTimeout(() => {
            persistNotes(noteDraftsRef.current);
        }, 400);
        return () => window.clearTimeout(timeoutId);
    }, [noteDrafts, persistNotes]);

    // Flush on unmount
    useEffect(() => {
        return () => {
            persistNotes(noteDraftsRef.current);
        };
    }, [persistNotes]);

    const handleAdd = useCallback(
        (targetProjectId: string) => {
            const updated = [...linkedProjectsRef.current, { projectId: targetProjectId, note: "" }];
            setNoteDrafts((prev) => ({ ...prev, [targetProjectId]: "" }));
            lastSavedNotes.current[targetProjectId] = "";
            void updateProject(project.id, { linkedProjects: updated });
            setAddPopoverOpen(false);
        },
        [project.id, updateProject],
    );

    const handleRemove = useCallback(
        (targetProjectId: string) => {
            const updated = linkedProjectsRef.current.filter(
                (lp) => lp.projectId !== targetProjectId,
            );
            setNoteDrafts((prev) => {
                const { [targetProjectId]: _, ...rest } = prev;
                return rest;
            });
            const { [targetProjectId]: _, ...restSaved } = lastSavedNotes.current;
            lastSavedNotes.current = restSaved;
            void updateProject(project.id, { linkedProjects: updated });
        },
        [project.id, updateProject],
    );

    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Linked Projects</span>
                <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={availableProjects.length === 0}
                            aria-label="Link a project">
                            <Plus className="h-3 w-3" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-2" align="end">
                        <div className="max-h-48 space-y-0.5 overflow-y-auto">
                            {availableProjects.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors"
                                    onClick={() => handleAdd(p.id)}>
                                    {p.name}
                                </button>
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            {linkedProjects.length > 0 && (
                <div className="mt-2 space-y-2">
                    {linkedProjects.map((lp) => (
                        <div
                            key={lp.projectId}
                            className="border-border/50 bg-muted/30 rounded-md border px-2.5 py-2">
                            <div className="flex items-center justify-between gap-1">
                                <span className="text-secondary-foreground truncate text-sm font-medium">
                                    {resolvedNames[lp.projectId] ?? lp.projectId}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => handleRemove(lp.projectId)}
                                    aria-label="Remove linked project">
                                    <X className="h-3 w-3" />
                                </Button>
                            </div>
                            <Input
                                value={noteDrafts[lp.projectId] ?? lp.note}
                                onChange={(e) =>
                                    setNoteDrafts((prev) => ({
                                        ...prev,
                                        [lp.projectId]: e.target.value,
                                    }))
                                }
                                placeholder="Relation note..."
                                className="mt-1 h-7 text-xs"
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export { LinkedProjectsSection };
