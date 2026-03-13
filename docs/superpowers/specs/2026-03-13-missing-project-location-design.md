# Missing Project Location Detection & Handling

## Problem

When a project's directory is moved, renamed, or deleted from the filesystem, Taskflow continues to display it normally. This leads to errors when the user tries to interact with the project. The app should detect missing locations at startup and guide the user to resolve the issue.

## Design

### Shared Types

Add `locationValid` to the `Project` interface in `packages/shared/src/types/project.ts`:

```typescript
export interface Project {
    id: string;
    name: string;
    path: string;
    sessions: SessionRef[];
    createdAt: string;
    locationValid?: boolean; // Set by backend when listing projects
}
```

The field is optional and computed at read time — it must never be persisted to `projects.json`. All write paths must strip `locationValid` before serializing (e.g., destructure it out before `JSON.stringify`).

Update `ProjectUpdatePayload` in `packages/shared/src/types/ws.ts`:

```typescript
export interface ProjectUpdatePayload {
    id: string;
    name?: string;  // Changed from required to optional
    path?: string;  // New: for relocating projects
}
```

Both `name` and `path` are optional — at least one must be provided. Making `name` optional allows `MissingLocationDialog` to update only the path without supplying a name.

### Backend

#### TaskStore.listProjects()

After reading projects from `projects.json`, check each project's path using `stat()` from `fs/promises` (consistent with existing `addProject()` pattern). Set `locationValid` on each project object before returning.

#### TaskStore.updateProject()

Currently accepts `Partial<Pick<Project, "name" | "sessions">>`. Extend the pick to include `"path"`:

- If `path` is provided, validate it the same way `addProject()` does: resolve to absolute path via `realpath()`, verify it's a directory via `stat()`, verify no other project uses the same path.
- Update the stored path and set `locationValid` accordingly.
- When writing to JSON, strip `locationValid` from the project object to avoid persisting ephemeral state. Use destructuring: `const { locationValid: _, ...storable } = project`.

#### project handler (PROJECT_UPDATE)

Update the handler to accept optional `name` and optional `path`. Pass both through to `TaskStore.updateProject()`. Guard that at least one of `name` or `path` is provided.

### Frontend

#### project-store.ts

Change `updateProject()` signature from `(id: string, name: string)` to accept an object:

```typescript
updateProject(id: string, updates: { name?: string; path?: string }): Promise<Project>;
```

Update the existing call site in `RenameProjectDialog` (or wherever rename is triggered) to use the new object form.

#### ProjectGroup.tsx

When `project.locationValid === false`:

- Show an `AlertTriangle` icon (from lucide-react) next to the project name with a tooltip: "Project location not found".
- Do not render task cards for this project. This also prevents `handleTaskClick` in `TaskSidebar` from activating an invalid project, since no task cards are clickable.
- On click, instead of calling `onProjectClick`, open the `MissingLocationDialog`.

#### MissingLocationDialog (new component)

Location: `packages/ui/src/components/sidebar/MissingLocationDialog.tsx`

A dialog shown when clicking a project with an invalid location:

- **Header:** "Project Location Not Found"
- **Body:** "The directory for **{project.name}** was not found at: `{project.path}`"
- **Actions:**
  - **Change Location** — Opens the native directory picker (same mechanism as `NewProjectDialog` using `window.taskflow?.selectProjectDirectory()`). On selection, calls `updateProject(id, { path: newPath })`. On success, closes dialog.
  - **Remove Project** — Uses `AlertDialog` (shadcn/ui, consistent with existing destructive confirmation patterns in `Workspace.tsx`). On confirm, calls `removeProject(id)`. On success, closes dialog.

#### Workspace activation

If a project has `locationValid === false`, do not call `setActiveProject()`. The `MissingLocationDialog` handles all interaction. The guard lives in `ProjectGroup.tsx`'s click handler — no workspace-level changes needed.

### What is NOT included

- Real-time filesystem watching for path changes (polling on list fetch is sufficient).
- Automatic path recovery or search for moved directories.
- Migration of stored task worktrees if project path changes.

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/types/project.ts` | Add `locationValid?: boolean` to `Project` |
| `packages/shared/src/types/ws.ts` | Make `name` optional, add optional `path` to `ProjectUpdatePayload` |
| `packages/backend/src/services/task-store.ts` | Check paths in `listProjects()`, accept `path` in `updateProject()`, strip `locationValid` on write |
| `packages/backend/src/handlers/project.ts` | Accept optional `name`/`path`, guard at least one provided |
| `packages/ui/src/stores/project-store.ts` | Change `updateProject()` to accept `{ name?, path? }` object |
| `packages/ui/src/components/sidebar/ProjectGroup.tsx` | Warning icon, hide tasks, intercept click for invalid projects |
| `packages/ui/src/components/sidebar/MissingLocationDialog.tsx` | New dialog component |
| `packages/ui/src/components/sidebar/TaskSidebar.tsx` | Pass dialog state/handlers if needed |
