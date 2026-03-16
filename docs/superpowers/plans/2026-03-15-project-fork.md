# Project Fork Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to fork a project into a sibling folder with a new git branch, adding it as a separate project in the sidebar.

**Architecture:** Backend receives a fork request, clones the repo locally into a sibling folder, creates a new branch, re-points the remote to the original upstream, and registers the clone as a new project. Frontend provides a dialog for branch/folder input and shows a success alert.

**Tech Stack:** TypeScript, Bun, React, Zustand, WebSocket, Radix UI Dialog, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-15-project-fork-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/shared/src/constants.ts` | Add `PROJECT_FORK` message constant |
| Modify | `packages/shared/src/types/ws.ts` | Add `ProjectForkPayload`, `ProjectForkResponse` types |
| Modify | `packages/backend/src/services/git-service.ts` | Add `getRemoteUrl`, `clone`, `setRemoteUrl`, `createBranch` methods |
| Modify | `packages/backend/src/handlers/project.ts` | Add `PROJECT_FORK` handler |
| Modify | `packages/ui/src/stores/project-store.ts` | Add `forkProject` method |
| Create | `packages/ui/src/components/workspace/ForkProjectDialog.tsx` | Fork dialog component |
| Modify | `packages/ui/src/components/workspace/TaskHeader.tsx` | Add Fork button + wire dialog |

---

## Task 1: Shared types and constants

**Files:**
- Modify: `packages/shared/src/constants.ts:7` (after `PROJECT_UPDATE`)
- Modify: `packages/shared/src/types/ws.ts:46` (after `ProjectUpdatePayload`)

- [ ] **Step 1: Add PROJECT_FORK constant**

In `packages/shared/src/constants.ts`, add after line 7 (`PROJECT_UPDATE: "project:update",`):

```ts
    PROJECT_FORK: "project:fork",
```

- [ ] **Step 2: Add payload and response types**

In `packages/shared/src/types/ws.ts`, add after the `ProjectUpdatePayload` interface (after line 46):

```ts

export interface ProjectForkPayload {
    projectId: string;
    branch: string;
    folderName?: string;
}

export interface ProjectForkResponse {
    project: Project;
    targetPath: string;
    branch: string;
}
```

- [ ] **Step 3: Verify build**

Run: `cd packages/shared && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add PROJECT_FORK message type and payload types"
```

---

## Task 2: GitService additions

**Files:**
- Modify: `packages/backend/src/services/git-service.ts` (add 4 new methods at end of class, before closing brace at line 385)

- [ ] **Step 1: Add `getRemoteUrl` method**

Add before the closing `}` of the `GitService` class (line 385):

```ts
    async getRemoteUrl(repoPath: string): Promise<string | null> {
        try {
            const output = await git(["remote", "get-url", "origin"], repoPath);
            return output.trim() || null;
        } catch {
            return null;
        }
    }
```

- [ ] **Step 2: Add `clone` method**

The `clone` command needs special handling because the target directory doesn't exist yet. Use `dirname(target)` as cwd. Add the `dirname` import if not already present (it is — line 3).

```ts
    async clone(source: string, target: string, branch: string): Promise<void> {
        await git(
            ["clone", "--local", "--branch", branch, source, target],
            dirname(target),
        );
    }
```

- [ ] **Step 3: Add `setRemoteUrl` method**

```ts
    async setRemoteUrl(repoPath: string, url: string): Promise<void> {
        await git(["remote", "set-url", "origin", url], repoPath);
    }
```

- [ ] **Step 4: Add `createBranch` method**

```ts
    async createBranch(repoPath: string, branch: string): Promise<void> {
        await git(["checkout", "-b", branch], repoPath);
    }
```

- [ ] **Step 5: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/git-service.ts
git commit -m "feat: add git clone, remote URL, and branch creation methods"
```

---

## Task 3: Backend fork handler

**Files:**
- Modify: `packages/backend/src/handlers/project.ts` (add new handler registration, add imports)

- [ ] **Step 1: Add import for `ProjectForkPayload`**

In `packages/backend/src/handlers/project.ts`, update the import on lines 2-6 to include `ProjectForkPayload`:

```ts
import type {
    Project,
    ProjectAddPayload,
    ProjectForkPayload,
    ProjectRemovePayload,
    ProjectUpdatePayload,
} from "@taskflow/shared";
```

- [ ] **Step 2: Add fs and path imports**

Add after the last existing import in `project.ts` (after line 10):

```ts
import { stat, rm } from "fs/promises";
import { dirname, join } from "path";
```

- [ ] **Step 3: Add slugify helper**

Add a module-level helper function before `registerProjectHandlers`:

```ts
function slugify(branch: string): string {
    return branch
        .toLowerCase()
        .replace(/[/ ]/g, "-")
        .replace(/[^a-z0-9\-.]/g, "");
}
```

- [ ] **Step 4: Add PROJECT_FORK handler**

Inside `registerProjectHandlers`, add after the `PROJECT_UPDATE` handler:

```ts
    router.register(MSG.PROJECT_FORK, async (payload) => {
        const { projectId, branch, folderName } = payload as ProjectForkPayload;

        const project = await store.getProject(projectId);
        if (!project) {
            throw new Error("Project not found");
        }

        const derivedFolder = folderName?.trim() || slugify(branch);
        if (!derivedFolder) {
            throw new Error("Could not derive folder name from branch");
        }

        const targetPath = join(dirname(project.path), derivedFolder);

        // Check target doesn't exist
        const exists = await stat(targetPath).then(() => true, () => false);
        if (exists) {
            throw new Error(`Folder already exists: ${targetPath}`);
        }

        const currentBranch = await gitService.getBranch(project.path);
        if (!currentBranch) {
            throw new Error("Could not determine current branch");
        }

        const remoteUrl = await gitService.getRemoteUrl(project.path);

        // Clone and set up — clean up on failure
        try {
            await gitService.clone(project.path, targetPath, currentBranch);
            await gitService.createBranch(targetPath, branch);
            if (remoteUrl) {
                await gitService.setRemoteUrl(targetPath, remoteUrl);
            }
        } catch (err) {
            // Clean up partial clone
            await rm(targetPath, { recursive: true, force: true }).catch(() => {});
            throw err;
        }

        // Derive name same as PROJECT_ADD handler
        const segments = targetPath.split("/").filter(Boolean).slice(-2).join("/");
        const newName = `${segments} (${branch})`;

        const newProject = await store.addProject({ name: newName, path: targetPath });

        return { project: newProject, targetPath, branch };
    });
```

- [ ] **Step 5: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handlers/project.ts
git commit -m "feat: add PROJECT_FORK handler with clone, branch, and remote setup"
```

---

## Task 4: Frontend project store

**Files:**
- Modify: `packages/ui/src/stores/project-store.ts` (add `forkProject` method, update interface and imports)

- [ ] **Step 1: Add import for `ProjectForkResponse`**

Update the import from `@taskflow/shared` to include `ProjectForkResponse`:

```ts
import type { Project, ProjectForkResponse } from "@taskflow/shared";
```

- [ ] **Step 2: Add `forkProject` to the store interface**

In the `ProjectStore` interface (around line 8), add:

```ts
    forkProject(projectId: string, branch: string, folderName?: string): Promise<ProjectForkResponse>;
```

- [ ] **Step 3: Add `forkProject` implementation**

Add inside the `create` callback, after the `removeProject` method:

```ts
    async forkProject(projectId, branch, folderName) {
        const response = await sendRequest<ProjectForkResponse>(MSG.PROJECT_FORK, {
            projectId,
            branch,
            folderName,
        });
        set((s) => ({ projects: [...s.projects, response.project] }));
        return response;
    },
```

- [ ] **Step 4: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/project-store.ts
git commit -m "feat: add forkProject method to project store"
```

---

## Task 5: ForkProjectDialog component

**Files:**
- Create: `packages/ui/src/components/workspace/ForkProjectDialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `packages/ui/src/components/workspace/ForkProjectDialog.tsx`:

```tsx
import { useState, useCallback, useEffect, useRef } from "react";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useProjectStore } from "@/stores/project-store";
import { alert } from "@/stores/dialog-store";

interface ForkProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project;
}

function slugify(branch: string): string {
    return branch
        .toLowerCase()
        .replace(/[/ ]/g, "-")
        .replace(/[^a-z0-9\-.]/g, "");
}

function getParentDir(path: string): string {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
}

export function ForkProjectDialog({ open, onOpenChange, project }: ForkProjectDialogProps) {
    const [branch, setBranch] = useState("");
    const [folder, setFolder] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const customFolder = useRef(false);
    const branchInputRef = useRef<HTMLInputElement>(null);
    const forkProject = useProjectStore((s) => s.forkProject);

    const parentDir = getParentDir(project.path);
    const targetPath = folder ? `${parentDir}/${folder}` : "";

    useEffect(() => {
        if (open) {
            setBranch("");
            setFolder("");
            setError(null);
            setLoading(false);
            customFolder.current = false;
            const timer = setTimeout(() => branchInputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [open]);

    const handleBranchChange = useCallback((value: string) => {
        setBranch(value);
        setError(null);
        if (!customFolder.current) {
            setFolder(slugify(value));
        }
    }, []);

    const handleFolderChange = useCallback((value: string) => {
        customFolder.current = true;
        setFolder(value);
        setError(null);
    }, []);

    const canSubmit = branch.trim() !== "" && folder.trim() !== "" && !loading;

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;
        setLoading(true);
        setError(null);
        try {
            const response = await forkProject(project.id, branch.trim(), folder.trim());
            onOpenChange(false);
            void alert({
                title: "Project forked",
                description: `Branch "${response.branch}" created in ${response.targetPath} and added as a new project.`,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Fork failed");
        } finally {
            setLoading(false);
        }
    }, [canSubmit, forkProject, project.id, branch, folder, onOpenChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [canSubmit, handleSubmit],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>Fork Project</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="fork-branch-name">Branch name</Label>
                        <Input
                            ref={branchInputRef}
                            id="fork-branch-name"
                            value={branch}
                            onChange={(e) => handleBranchChange(e.target.value)}
                            placeholder="feature/my-branch"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="fork-folder-name">
                            Folder name{" "}
                            <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Input
                            id="fork-folder-name"
                            value={folder}
                            onChange={(e) => handleFolderChange(e.target.value)}
                            placeholder={slugify(branch) || "derived-from-branch"}
                        />
                        {targetPath && (
                            <p className="text-muted-foreground text-xs">
                                Will be created at: {targetPath}
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="text-destructive text-sm">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleSubmit()}
                        disabled={!canSubmit}
                        loading={loading}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                        Fork
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build, no errors. The `Button` component supports the `loading` prop.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/ForkProjectDialog.tsx
git commit -m "feat: add ForkProjectDialog component"
```

---

## Task 6: Wire Fork button into TaskHeader

**Files:**
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`

- [ ] **Step 1: Add imports**

Add to the lucide-react import (line 13-22), add `GitFork`:

```ts
import {
    Archive,
    ArrowUpFromLine,
    Diff,
    FolderTree,
    GitCommitHorizontal,
    GitFork,
    NotebookText,
    Pencil,
    Trash2,
} from "lucide-react";
```

Add the ForkProjectDialog import after the CommitDialog import (line 12):

```ts
import { ForkProjectDialog } from "./ForkProjectDialog";
```

- [ ] **Step 2: Add fork dialog state**

Inside the `TaskHeader` component, add alongside the existing `renameOpen` and `commitOpen` state (after line 42):

```ts
    const [forkOpen, setForkOpen] = useState(false);
```

- [ ] **Step 3: Add Fork button**

Insert after the Diff button block (after line 191, the closing of the `showDiffButton` conditional), before the archive button:

```tsx
                    {showGitButtons && !task && project && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setForkOpen(true)}
                            aria-label="Fork project"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <GitFork className="h-3 w-3" />
                            <span className="text-xs">Fork</span>
                        </Button>
                    )}
```

- [ ] **Step 4: Add ForkProjectDialog rendering**

Add after the `CommitDialog` rendering (after line 258), inside the return but before the closing `</div>`:

```tsx
            {project && (
                <ForkProjectDialog
                    open={forkOpen}
                    onOpenChange={setForkOpen}
                    project={project}
                />
            )}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat: add Fork button and dialog to TaskHeader"
```

---

## Task 7: Manual testing

- [ ] **Step 1: Start the app**

Run the app in dev mode. Open a project.

- [ ] **Step 2: Verify Fork button appears**

Confirm the Fork button shows in the project header, after Diff, with the GitFork icon.

- [ ] **Step 3: Test the dialog**

Click Fork. Verify:
- Dialog opens with focus on branch name input
- Typing a branch name auto-populates the folder name (slugified)
- Editing folder name stops auto-derive
- Path preview updates correctly
- Empty branch name disables the Fork button

- [ ] **Step 4: Test forking**

Enter a branch name (e.g., `test/fork-feature`) and click Fork. Verify:
- Loading state appears on button
- New folder is created as sibling to current project
- Success alert shows with correct branch and path
- New project appears in the sidebar
- Current project stays selected
- The forked project, when selected, shows the new branch
- The forked repo has the correct remote URL (not pointing to the local source)

- [ ] **Step 5: Test error cases**

- Try forking with a folder name that already exists → should show error
- Try forking with an invalid branch name → should show git error

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during fork feature testing"
```
