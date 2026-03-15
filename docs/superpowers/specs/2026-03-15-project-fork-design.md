# Project Fork Feature

## Overview

Allow users to fork a project into a sibling folder with a new git branch. The forked project appears as a separate entry in the project list, enabling parallel work on different branches of the same repo — similar to manually cloning a repo into a second folder and adding it as a project.

## User Flow

1. User views a project in the workspace (project level, not task level)
2. Clicks the **Fork** button in the TaskHeader (positioned after Diff button)
3. A dialog appears with:
   - **Branch name** (required) — the new branch to create
   - **Folder name** (optional) — defaults to a slugified version of the branch name
   - **Path preview** — shows the full resolved path: `parentDir/folderName`
4. User confirms, backend clones the repo and creates the branch
5. Success alert dialog appears with the branch name and path
6. User stays on the current project; the forked project is added to the sidebar

## UI Components

### Fork Button (TaskHeader)

- Placement: after the Diff button, before the rename/delete buttons
- Visibility: only when viewing a project (not a task) — same condition as the rename button (`!task && project`)
- Style: `variant="ghost" size="xs"` with `GitFork` icon from lucide-react and "Fork" label
- Uses `[-webkit-app-region:no-drag]` class like other header buttons

### ForkProjectDialog

Location: `packages/ui/src/components/workspace/ForkProjectDialog.tsx`

Props:
```ts
interface ForkProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project;
}
```

Behavior:
- Branch name input: required, auto-focused on open
- Folder name input: auto-derives from branch name via slugify as user types; once manually edited, auto-derive stops (tracked by a `customFolder` boolean ref)
- Path preview: `dirname(project.path) + "/" + folderName`, shown as helper text below the folder input
- Loading state on Fork button during backend call
- Error display if backend returns error (e.g., folder exists, branch exists)
- On success: closes dialog, calls `alert()` from `dialog-store` with branch name and path info
- On close: resets form state

Slugify logic (branch → folder name):
- Replace `/` and spaces with `-`
- Remove characters not matching `[a-z0-9\-.]`
- Lowercase

### Success Alert

Uses existing `alert()` from `dialog-store`:
- Title: "Project forked"
- Description: Branch name and target path

## Backend

### New Message Type

In `packages/shared/src/constants.ts`:
```ts
PROJECT_FORK: "project:fork"
```

### New Types

In `packages/shared/src/types/ws.ts`:
```ts
interface ProjectForkPayload {
    projectId: string;
    branch: string;
    folderName?: string;
}

interface ProjectForkResponse {
    project: Project;
    targetPath: string;
    branch: string;
}
```

### Handler (project.ts)

Registered in `registerProjectHandlers` as `MSG.PROJECT_FORK`.

Steps:
1. Look up source project by `projectId` via `store.getProject()`
2. Derive folder name: if `folderName` not provided, slugify the branch name
3. Compute target path: `dirname(sourcePath) + "/" + folderName`
4. Validate target path does not exist (check with `fs.stat` or similar)
5. Get the current branch: `gitService.getBranch(sourcePath)`
6. Get original remote URL: `gitService.getRemoteUrl(sourcePath)` (may be null if no remote)
7. Clone: `git clone --local --branch <currentBranch> <sourcePath> <targetPath>`
8. Create new branch in clone: `git checkout -b <newBranch>` in `targetPath`
9. If original remote URL exists, re-point: `git remote set-url origin <originalRemoteUrl>` in `targetPath`
10. Add as project: `store.addProject({ name: auto-generated, path: targetPath })`
11. Return `{ project, targetPath, branch }`

Error handling:
- Target folder exists → throw with descriptive message
- Clone fails → clean up partial target folder with `rm -rf`, then throw
- Branch already exists → git will error on `checkout -b`, propagate the error

### GitService Additions

In `packages/backend/src/services/git-service.ts`, add:

```ts
async getRemoteUrl(repoPath: string): Promise<string | null>
// Runs: git remote get-url origin
// Returns null if no remote configured

async clone(source: string, target: string, branch: string): Promise<void>
// Runs: git clone --local --branch <branch> <source> <target>

async setRemoteUrl(repoPath: string, url: string): Promise<void>
// Runs: git remote set-url origin <url>

async createBranch(repoPath: string, branch: string): Promise<void>
// Runs: git checkout -b <branch>
```

## Project Store (Frontend)

In `packages/ui/src/stores/project-store.ts`, add:

```ts
async forkProject(projectId: string, branch: string, folderName?: string): Promise<ProjectForkResponse>
// Sends PROJECT_FORK request
// Adds returned project to local projects array
// Returns the response for the dialog to show in the success alert
```

## Validation

- Target folder existence: checked server-side before cloning, error propagated to dialog
- Branch name: validated by git itself (invalid branch names cause `checkout -b` to fail)
- No validation on uncommitted changes — user confirmed this is fine

## Files to Create/Modify

**Create:**
- `packages/ui/src/components/workspace/ForkProjectDialog.tsx`

**Modify:**
- `packages/shared/src/constants.ts` — add `PROJECT_FORK`
- `packages/shared/src/types/ws.ts` — add `ProjectForkPayload`, `ProjectForkResponse`
- `packages/backend/src/services/git-service.ts` — add `getRemoteUrl`, `clone`, `setRemoteUrl`, `createBranch`
- `packages/backend/src/handlers/project.ts` — add `PROJECT_FORK` handler
- `packages/ui/src/stores/project-store.ts` — add `forkProject` method
- `packages/ui/src/components/workspace/TaskHeader.tsx` — add Fork button and ForkProjectDialog
