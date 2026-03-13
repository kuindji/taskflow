# Missing Project Location Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect missing project directories at startup and let users resolve by changing the location or removing the project.

**Architecture:** Backend validates project paths when listing and exposes `locationValid` on each project. UI renders a warning icon for invalid projects, hides their tasks, and shows a resolution dialog on click.

**Tech Stack:** TypeScript, Bun fs APIs, React, Zustand, shadcn/ui Dialog, lucide-react icons.

---

## Chunk 1: Backend & Shared Types

### Task 1: Add `locationValid` to shared Project type

**Files:**
- Modify: `packages/shared/src/types/project.ts:1-9`

- [ ] **Step 1: Add the field**

```typescript
import type { SessionRef } from "./task";

export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    createdAt: string;
    locationValid?: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types/project.ts
git commit -m "feat: add locationValid field to Project type"
```

### Task 2: Update ProjectUpdatePayload to support optional name and path

**Files:**
- Modify: `packages/shared/src/types/ws.ts:41-44`

- [ ] **Step 1: Update the payload type**

Change `ProjectUpdatePayload` from:
```typescript
export interface ProjectUpdatePayload {
    id: string;
    name: string;
}
```
To:
```typescript
export interface ProjectUpdatePayload {
    id: string;
    name?: string;
    path?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types/ws.ts
git commit -m "feat: make name optional and add path to ProjectUpdatePayload"
```

### Task 3: Add location validation and path update support to TaskStore

**Important:** `listProjects()` and `updateProject()` must be changed together in a single commit. After `listProjects()` sets `locationValid`, all write paths (`addProject`, `updateProject`, `removeProject`) must strip it before serializing. Splitting these changes would corrupt `projects.json` with ephemeral fields.

**Files:**
- Modify: `packages/backend/src/services/task-store.ts:78-101,191-211`

- [ ] **Step 1: Add the `stripEphemeralFields` helper**

Add this private method to the `TaskStore` class (before `listProjects`):

```typescript
private stripEphemeralFields(projects: Project[]): Omit<Project, "locationValid">[] {
    return projects.map(({ locationValid: _, ...rest }) => rest);
}
```

- [ ] **Step 2: Update `listProjects()` to validate paths**

Replace the `listProjects()` method (lines 78-101):

```typescript
async listProjects(): Promise<Project[]> {
    let data: string;
    try {
        data = await readFile(this.config.projectsFile, "utf-8");
    } catch (error) {
        if (isMissingFileError(error)) {
            return [];
        }
        throw error;
    }

    let projects: Project[];
    try {
        const parsed = JSON.parse(data) as Array<Project & { sessions?: Project["sessions"] }>;
        projects = parsed.map((project) => ({
            ...project,
            sessions: project.sessions ?? [],
        }));
    } catch (error) {
        if (isJsonParseError(error)) {
            return [];
        }
        throw error;
    }

    await Promise.all(
        projects.map(async (project) => {
            try {
                const info = await stat(project.path);
                project.locationValid = info.isDirectory();
            } catch {
                project.locationValid = false;
            }
        }),
    );

    return projects;
}
```

- [ ] **Step 3: Update `updateProject()` to accept `path` and strip ephemeral fields**

Replace the `updateProject()` method (lines 191-211):

```typescript
async updateProject(
    id: string,
    updates:
        | Partial<Pick<Project, "name" | "path" | "sessions">>
        | ((project: Project) => Partial<Pick<Project, "name" | "path" | "sessions">>),
): Promise<Project> {
    const projects = await this.listProjects();
    const index = projects.findIndex((p) => p.id === id);
    if (index === -1) {
        throw new Error(`Project not found: ${id}`);
    }
    const resolvedUpdates = typeof updates === "function" ? updates(projects[index]) : updates;

    let resolvedPath = projects[index].path;
    if (resolvedUpdates.path) {
        resolvedPath = await realpath(resolvedUpdates.path).catch(() => resolvedUpdates.path!);
        const info = await stat(resolvedPath);
        if (!info.isDirectory()) {
            throw new Error(`Project path is not a directory: ${resolvedPath}`);
        }
        const duplicate = projects.find((p) => p.id !== id && p.path === resolvedPath);
        if (duplicate) {
            throw new Error(`A project already exists at this path: ${duplicate.name}`);
        }
    }

    projects[index] = {
        ...projects[index],
        ...resolvedUpdates,
        name: resolvedUpdates.name ? resolvedUpdates.name.trim() : projects[index].name,
        path: resolvedPath,
        sessions: resolvedUpdates.sessions ?? projects[index].sessions,
    };
    await writeFile(this.config.projectsFile, JSON.stringify(this.stripEphemeralFields(projects), null, 2));

    // Re-validate location after path change
    try {
        const info = await stat(projects[index].path);
        projects[index].locationValid = info.isDirectory();
    } catch {
        projects[index].locationValid = false;
    }

    return projects[index];
}
```

- [ ] **Step 4: Update `addProject()` write call to strip ephemeral fields**

In `addProject()` (line 182), change:
```typescript
await writeFile(this.config.projectsFile, JSON.stringify(projects, null, 2));
```
To:
```typescript
await writeFile(this.config.projectsFile, JSON.stringify(this.stripEphemeralFields(projects), null, 2));
```

- [ ] **Step 5: Update `removeProject()` write call to strip ephemeral fields**

In `removeProject()` (line 235), change:
```typescript
await writeFile(this.config.projectsFile, JSON.stringify(filtered, null, 2));
```
To:
```typescript
await writeFile(this.config.projectsFile, JSON.stringify(this.stripEphemeralFields(filtered), null, 2));
```

- [ ] **Step 6: Verify the backend builds**

Run: `cd packages/backend && bun run build`

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/task-store.ts
git commit -m "feat: validate project locations in listProjects and support path updates in updateProject"
```

### Task 4: Update PROJECT_UPDATE handler to pass path

**Files:**
- Modify: `packages/backend/src/handlers/project.ts:1-6,49-52`

- [ ] **Step 1: Add `Project` to imports**

Change:
```typescript
import type {
    ProjectAddPayload,
    ProjectRemovePayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
```
To:
```typescript
import type {
    Project,
    ProjectAddPayload,
    ProjectRemovePayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
```

- [ ] **Step 2: Update the handler**

Replace the `PROJECT_UPDATE` handler (lines 49-52):

```typescript
router.register(MSG.PROJECT_UPDATE, async (payload) => {
    const { id, name, path } = payload as ProjectUpdatePayload;
    if (!name && !path) {
        throw new Error("At least one of name or path must be provided");
    }
    const updates: Partial<Pick<Project, "name" | "path">> = {};
    if (name) updates.name = name;
    if (path) updates.path = path;
    return store.updateProject(id, updates);
});
```

- [ ] **Step 3: Verify the backend builds**

Run: `cd packages/backend && bun run build`

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/project.ts
git commit -m "feat: handle optional path in PROJECT_UPDATE handler"
```

---

## Chunk 2: Frontend Changes

**Note:** `packages/ui/src/components/sidebar/TaskSidebar.tsx` requires **no changes**. The guard against activating invalid projects lives in `ProjectGroup.tsx`'s click handler, which intercepts the click before `onProjectClick` (and thus `handleProjectClick` in `TaskSidebar`) is ever called. Tasks are also hidden for invalid projects, preventing `handleTaskClick` from reaching an invalid project's tasks.

### Task 5: Update project-store to accept object-form updates

**Files:**
- Modify: `packages/ui/src/stores/project-store.ts:8-14,34-39`

- [ ] **Step 1: Change the store interface and implementation**

Update the interface:
```typescript
interface ProjectStore {
    projects: Project[];
    loading: boolean;
    fetchProjects(): Promise<void>;
    addProject(path: string): Promise<Project>;
    updateProject(id: string, updates: { name?: string; path?: string }): Promise<Project>;
    removeProject(id: string): Promise<void>;
}
```

Update the implementation (lines 34-39):
```typescript
async updateProject(id, updates) {
    const project = await sendRequest<Project>(MSG.PROJECT_UPDATE, { id, ...updates });
    set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? project : p)),
    }));
    return project;
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/project-store.ts
git commit -m "feat: change updateProject to accept object-form updates"
```

### Task 6: Update existing updateProject call site

**Files:**
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx:54`

- [ ] **Step 1: Update the rename call**

Change:
```typescript
void updateProject(project.id, name);
```
To:
```typescript
void updateProject(project.id, { name });
```

- [ ] **Step 2: Verify it builds**

Run: `cd packages/ui && bun run build`

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "refactor: update rename call to use object-form updateProject"
```

### Task 7: Create MissingLocationDialog component

**Files:**
- Create: `packages/ui/src/components/sidebar/MissingLocationDialog.tsx`

- [ ] **Step 1: Create the dialog**

```tsx
import { useState, useCallback } from "react";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";

interface MissingLocationDialogProps {
    project: Project | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MissingLocationDialog({
    project,
    open,
    onOpenChange,
}: MissingLocationDialogProps) {
    const updateProject = useProjectStore((s) => s.updateProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChangeLocation = useCallback(async () => {
        if (!project) return;
        setError(null);
        const selected = await window.taskflow?.selectProjectDirectory();
        if (!selected) return;
        try {
            await updateProject(project.id, { path: selected });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update project location");
        }
    }, [project, updateProject, onOpenChange]);

    const handleRemove = useCallback(async () => {
        if (!project) return;
        await removeProject(project.id);
        setConfirmRemoveOpen(false);
        onOpenChange(false);
    }, [project, removeProject, onOpenChange]);

    if (!project) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Project Location Not Found</DialogTitle>
                        <DialogDescription>
                            The directory for <strong>{project.name}</strong> was not found at:
                        </DialogDescription>
                    </DialogHeader>

                    <code className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs break-all">
                        {project.path}
                    </code>

                    {error && <p className="text-destructive text-xs">{error}</p>}

                    <DialogFooter>
                        <Button
                            variant="destructive"
                            onClick={() => setConfirmRemoveOpen(true)}
                        >
                            Remove Project
                        </Button>
                        <Button
                            onClick={() => void handleChangeLocation()}
                            className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2"
                        >
                            <FolderOpen className="h-4 w-4" />
                            Change Location
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Project?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove <strong>{project.name}</strong> and delete all its
                            tasks. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void handleRemove()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/MissingLocationDialog.tsx
git commit -m "feat: add MissingLocationDialog component"
```

### Task 8: Update ProjectGroup to show warning and intercept click

**Files:**
- Modify: `packages/ui/src/components/sidebar/ProjectGroup.tsx`

- [ ] **Step 1: Add warning icon, hide tasks, add dialog trigger**

Replace the full component:

```tsx
import { useState } from "react";
import type { Project, Task } from "@taskflow/shared";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TaskCard } from "./TaskCard";
import { MissingLocationDialog } from "./MissingLocationDialog";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    onProjectClick: (projectId: string) => void;
    onTaskClick: (taskId: string) => void;
    archived?: boolean;
    isFirstVisibleProject?: boolean;
}

export function ProjectGroup({
    project,
    tasks,
    activeTaskId,
    isActive,
    diffStats,
    onProjectClick,
    onTaskClick,
    archived,
    isFirstVisibleProject = false,
}: ProjectGroupProps) {
    const [open, setOpen] = useState(true);
    const [missingDialogOpen, setMissingDialogOpen] = useState(false);

    const locationInvalid = project.locationValid === false;

    const handleProjectClick = () => {
        if (locationInvalid) {
            setMissingDialogOpen(true);
        } else {
            onProjectClick(project.id);
        }
    };

    return (
        <>
            <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
                <div
                    className={cn(
                        "group mx-1.5 flex min-w-0 max-w-[calc(100%-0.75rem)] cursor-pointer items-center overflow-hidden rounded-lg transition-colors [-webkit-app-region:no-drag]",
                        isActive && !locationInvalid ? "bg-accent/15" : "hover:bg-muted/50",
                    )}
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setOpen((value) => !value);
                                }}
                                aria-label={open ? "Collapse project" : "Expand project"}
                                className="text-muted-foreground flex h-full shrink-0 items-center px-1.5 py-1.5"
                            >
                                {open ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side={isFirstVisibleProject ? "bottom" : undefined} sideOffset={4}>
                            {open ? "Collapse project" : "Expand project"}
                        </TooltipContent>
                    </Tooltip>
                    <button
                        onClick={handleProjectClick}
                        className="flex w-0 min-w-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 pr-1.5 text-left"
                        title={project.name}
                    >
                        {locationInvalid && (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertTriangle className="text-warning h-3.5 w-3.5 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side={isFirstVisibleProject ? "bottom" : undefined} sideOffset={4}>
                                    Project location not found
                                </TooltipContent>
                            </Tooltip>
                        )}
                        <span className={cn(
                            "block w-full min-w-0 truncate text-xs font-medium tracking-wide",
                            locationInvalid ? "text-muted-foreground/60" : "text-muted-foreground",
                        )}>
                            {project.name}
                        </span>
                    </button>
                    <div className="relative mr-1.5 flex shrink-0 items-center">
                        {!locationInvalid && diffStats && (
                            <Badge
                                variant="outline"
                                className="gap-1.5 border-border/60 bg-muted/50 px-1.5 py-0 text-[10px] font-medium transition-opacity group-hover:opacity-0"
                            >
                                <span className="text-success">+{diffStats.additions}</span>
                                <span className="text-destructive">-{diffStats.deletions}</span>
                            </Badge>
                        )}
                        {!locationInvalid && (
                            <ArrowRight className="text-accent absolute right-0 h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                        )}
                    </div>
                </div>
                {!locationInvalid && (
                    <CollapsibleContent>
                        {tasks.map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                isActive={task.id === activeTaskId}
                                onClick={() => onTaskClick(task.id)}
                                archived={archived}
                            />
                        ))}
                    </CollapsibleContent>
                )}
            </Collapsible>

            <MissingLocationDialog
                project={project}
                open={missingDialogOpen}
                onOpenChange={setMissingDialogOpen}
            />
        </>
    );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd packages/ui && bun run build`

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/ProjectGroup.tsx
git commit -m "feat: show warning icon and missing location dialog for invalid projects"
```

### Task 9: End-to-end verification

- [ ] **Step 1: Build the full app**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`

- [ ] **Step 2: Manual test**

1. Start the app
2. Add a project pointing to a valid directory — verify it works normally
3. Manually edit `~/.config/taskflow/projects.json` to change a project's path to a non-existent directory
4. Restart the app — verify the project shows a warning icon, no tasks are listed, and clicking it opens the MissingLocationDialog
5. Test "Change Location" — pick a valid directory, verify the project updates
6. Test "Remove Project" — verify the confirmation dialog appears and the project is removed

- [ ] **Step 3: Final commit (if any fixes needed)**
