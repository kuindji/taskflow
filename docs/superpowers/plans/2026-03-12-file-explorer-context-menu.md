# File Explorer Context Menu Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add right-click context menu to FileTree with rename, delete, copy path, open in external editor, and reveal in Finder actions.

**Architecture:** Four new WS message types (FILE_RENAME, FILE_DELETE_FILE, FILE_OPEN_EXTERNAL, FILE_REVEAL) with backend handlers. A new shadcn ContextMenu primitive, a FileContextMenu wrapper component, and two dialog components (rename + delete confirmation). The existing FileWatcher auto-refreshes the tree after rename/delete.

**Tech Stack:** Radix UI (unified `radix-ui` package), shadcn component patterns, Bun test runner, `fs/promises` for file ops.

---

## Chunk 1: Shared Constants & Types + Backend Handlers

### Task 1: Add shared constants and payload types

**Files:**
- Modify: `packages/shared/src/constants.ts:36-43` (Files section)
- Modify: `packages/shared/src/types/ws.ts:168-207` (File messages section)

- [ ] **Step 1: Add new MSG constants**

In `packages/shared/src/constants.ts`, add four new constants to the `// Files` section after `FILE_STAT`:

```typescript
FILE_RENAME: "file:rename",
FILE_DELETE_FILE: "file:delete",
FILE_OPEN_EXTERNAL: "file:open-external",
FILE_REVEAL: "file:reveal",
```

- [ ] **Step 2: Add payload types**

In `packages/shared/src/types/ws.ts`, add after the `FileStatResponse` interface (line ~205):

Note: `FileDeletePayload`, `FileOpenExternalPayload`, and `FileRevealPayload` all have the same shape `{ path: string }` which is identical to existing types like `FileStatPayload`. To follow the project guideline of not duplicating types, define a single shared `FilePathPayload` and alias the others:

```typescript
export interface FileRenamePayload {
    oldPath: string;
    newPath: string;
}

export interface FilePathPayload {
    path: string;
}
```

Then in handlers, use `FilePathPayload` for delete, open-external, and reveal (instead of three separate identical interfaces). Update all handler code in Task 2 accordingly — replace `FileDeletePayload`, `FileOpenExternalPayload`, `FileRevealPayload` with `FilePathPayload`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add file rename/delete/reveal message types and constants"
```

### Task 2: Add backend file handlers

**Files:**
- Modify: `packages/backend/src/handlers/file.ts`
- Modify: `packages/backend/src/utils/path-validation.ts`

- [ ] **Step 1: Add `assertMutableWorkspacePath` helper**

In `packages/backend/src/utils/path-validation.ts`, add and export a new function that combines `assertWorkspacePath` + root rejection into a single call (avoiding double `listWorkspaceRoots` I/O):

```typescript
export async function assertMutableWorkspacePath(taskStore: TaskStore, path: string): Promise<string> {
    const [roots, resolvedPath] = await Promise.all([
        listWorkspaceRoots(taskStore),
        resolveWorkspacePath(path),
    ]);
    if (!roots.some((root) => isWithinRoot(resolvedPath, root))) {
        throw new Error(`Path is outside known workspaces: ${path}`);
    }
    if (roots.includes(resolvedPath)) {
        throw new Error("Cannot modify workspace root");
    }
    return resolvedPath;
}
```

This resolves roots once and checks both workspace membership and root rejection in a single pass.

- [ ] **Step 2: Register FILE_RENAME handler**

In `packages/backend/src/handlers/file.ts`, add imports and the handler. Add `rename` to the existing `fs/promises` import (note: `stat` is already imported as `fsStat`). Add `import { assertMutableWorkspacePath } from "../utils/path-validation"`. Then register:

```typescript
router.register(MSG.FILE_RENAME, async (payload) => {
    const { oldPath, newPath } = payload as FileRenamePayload;
    const resolvedOld = await assertMutableWorkspacePath(taskStore, oldPath);
    const resolvedNew = await assertWorkspacePath(taskStore, newPath);
    try {
        await fsStat(resolvedNew);
        throw new Error("A file or folder with that name already exists");
    } catch (e) {
        if (e instanceof Error && e.message === "A file or folder with that name already exists") throw e;
        // ENOENT is expected — target doesn't exist, proceed
    }
    await rename(resolvedOld, resolvedNew);
    return { success: true };
});
```

Add `FileRenamePayload` to the imports from `@taskflow/shared`.

- [ ] **Step 3: Register FILE_DELETE_FILE handler**

```typescript
router.register(MSG.FILE_DELETE_FILE, async (payload) => {
    const { path } = payload as FilePathPayload;
    const resolvedPath = await assertMutableWorkspacePath(taskStore, path);
    await rm(resolvedPath, { recursive: true });
    return { success: true };
});
```

Add `rm` to the `fs/promises` import. Add `FilePathPayload` to the shared imports.

- [ ] **Step 4: Register FILE_OPEN_EXTERNAL handler**

```typescript
router.register(MSG.FILE_OPEN_EXTERNAL, async (payload) => {
    const { path } = payload as FilePathPayload;
    const resolvedPath = await assertWorkspacePath(taskStore, path);
    const editor = process.env.EDITOR || "code";
    const which = Bun.which(editor);
    if (!which) {
        throw new Error(`Editor "${editor}" not found on PATH`);
    }
    Bun.spawn([which, resolvedPath], {
        stdio: ["ignore", "ignore", "ignore"],
    });
    return { success: true };
});
```

- [ ] **Step 5: Register FILE_REVEAL handler**

```typescript
router.register(MSG.FILE_REVEAL, async (payload) => {
    const { path } = payload as FilePathPayload;
    const resolvedPath = await assertWorkspacePath(taskStore, path);
    Bun.spawn(["open", "-R", resolvedPath], {
        stdio: ["ignore", "ignore", "ignore"],
    });
    return { success: true };
});
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/handlers/file.ts packages/backend/src/utils/path-validation.ts
git commit -m "feat: add rename, delete, open-external, reveal file handlers"
```

### Task 3: Add backend tests for new handlers

**Files:**
- Create: `packages/backend/tests/handlers/file.test.ts`

- [ ] **Step 1: Write tests**

Follow the pattern from `packages/backend/tests/handlers/project.test.ts`. Create a temp directory, init TaskStore, add a project pointing to a sub-dir, then register file handlers.

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { registerFileHandlers } from "../../src/handlers/file";
import { Router } from "../../src/ws/router";
import { TaskStore } from "../../src/services/task-store";
import { FileWatcher } from "../../src/services/file-watcher";
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { realpath } from "fs/promises";

describe("file handlers", () => {
    let router: Router;
    let store: TaskStore;
    let fileWatcher: FileWatcher;
    let tempDir: string;
    let projectDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-file-test-"));
        tempDir = await realpath(tempDir);
        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();

        // Create a project directory and register it
        projectDir = join(tempDir, "my-project");
        await mkdir(projectDir, { recursive: true });
        await store.addProject({ name: "test", path: projectDir });

        fileWatcher = new FileWatcher();
        router = new Router();
        const broadcast = () => {};
        registerFileHandlers({ router, fileWatcher, taskStore: store, broadcast });
    });

    afterEach(async () => {
        fileWatcher.stopAll();
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("FILE_RENAME", () => {
        it("renames a file", async () => {
            const filePath = join(projectDir, "old.txt");
            await writeFile(filePath, "hello");
            const newPath = join(projectDir, "new.txt");

            const result = await router.handle(MSG.FILE_RENAME, {
                oldPath: filePath,
                newPath,
            });

            expect(result).toEqual({ success: true });
            const content = await readFile(newPath, "utf-8");
            expect(content).toBe("hello");
            await expect(stat(filePath)).rejects.toThrow();
        });

        it("rejects rename when target exists", async () => {
            const filePath = join(projectDir, "a.txt");
            const targetPath = join(projectDir, "b.txt");
            await writeFile(filePath, "a");
            await writeFile(targetPath, "b");

            await expect(
                router.handle(MSG.FILE_RENAME, { oldPath: filePath, newPath: targetPath }),
            ).rejects.toThrow("already exists");
        });

        it("rejects rename of workspace root", async () => {
            const newPath = join(tempDir, "renamed-project");
            await expect(
                router.handle(MSG.FILE_RENAME, { oldPath: projectDir, newPath }),
            ).rejects.toThrow("Cannot modify workspace root");
        });

        it("rejects rename outside workspace", async () => {
            const outsidePath = join(tmpdir(), "outside.txt");
            await expect(
                router.handle(MSG.FILE_RENAME, {
                    oldPath: join(projectDir, "a.txt"),
                    newPath: outsidePath,
                }),
            ).rejects.toThrow("outside");
        });
    });

    describe("FILE_DELETE_FILE", () => {
        it("deletes a file", async () => {
            const filePath = join(projectDir, "delete-me.txt");
            await writeFile(filePath, "bye");

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: filePath });

            expect(result).toEqual({ success: true });
            await expect(stat(filePath)).rejects.toThrow();
        });

        it("deletes a directory recursively", async () => {
            const dirPath = join(projectDir, "subdir");
            await mkdir(dirPath);
            await writeFile(join(dirPath, "child.txt"), "data");

            const result = await router.handle(MSG.FILE_DELETE_FILE, { path: dirPath });

            expect(result).toEqual({ success: true });
            await expect(stat(dirPath)).rejects.toThrow();
        });

        it("rejects delete of workspace root", async () => {
            await expect(
                router.handle(MSG.FILE_DELETE_FILE, { path: projectDir }),
            ).rejects.toThrow("Cannot modify workspace root");
        });
    });

    describe("FILE_REVEAL", () => {
        it("accepts a valid path", async () => {
            const filePath = join(projectDir, "reveal-me.txt");
            await writeFile(filePath, "hi");

            // Just verify it doesn't throw — actually spawning `open` is fine in tests
            const result = await router.handle(MSG.FILE_REVEAL, { path: filePath });
            expect(result).toEqual({ success: true });
        });
    });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/handlers/file.test.ts`

Expected: All tests pass. The `FILE_OPEN_EXTERNAL` test is omitted since it depends on `$EDITOR`/`code` being on PATH, which is environment-dependent.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/tests/handlers/file.test.ts
git commit -m "test: add file handler tests for rename, delete, reveal"
```

---

## Chunk 2: UI — Context Menu Primitive + FileContextMenu + Dialogs

### Task 4: Add shadcn ContextMenu primitive

**Files:**
- Create: `packages/ui/src/components/ui/context-menu.tsx`

- [ ] **Step 1: Create the ContextMenu component**

Model it on the existing `packages/ui/src/components/ui/dropdown-menu.tsx` pattern — same import style (`from "radix-ui"`), same className patterns. The ContextMenu API mirrors DropdownMenu almost exactly. We only need: Root, Trigger, Portal, Content, Item, Separator.

```typescript
import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function ContextMenu({ ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
    return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Content
                data-slot="context-menu-content"
                className={cn(
                    "bg-card text-popover-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-md border border-border p-1 shadow-md",
                    className,
                )}
                {...props}
            />
        </ContextMenuPrimitive.Portal>
    );
}

function ContextMenuItem({
    className,
    variant = "default",
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
    variant?: "default" | "destructive";
}) {
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-variant={variant}
            className={cn(
                "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-destructive! relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                className,
            )}
            {...props}
        />
    );
}

function ContextMenuSeparator({
    className,
    ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
    return (
        <ContextMenuPrimitive.Separator
            data-slot="context-menu-separator"
            className={cn("bg-border -mx-1 my-1 h-px", className)}
            {...props}
        />
    );
}

export {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/ui/context-menu.tsx
git commit -m "feat: add shadcn ContextMenu primitive"
```

### Task 5: Add file store actions

**Files:**
- Modify: `packages/ui/src/stores/file-store.ts`

- [ ] **Step 1: Add renameFile, deleteFile, openExternal, revealInFinder to the store**

Add four new methods to the `FileStore` interface:

```typescript
renameFile(oldPath: string, newPath: string): Promise<void>;
deleteFile(path: string): Promise<void>;
openExternal(path: string): Promise<void>;
revealInFinder(path: string): Promise<void>;
```

And implement them in the store body:

```typescript
async renameFile(oldPath, newPath) {
    await sendRequest(MSG.FILE_RENAME, { oldPath, newPath });
},
async deleteFile(path) {
    await sendRequest(MSG.FILE_DELETE_FILE, { path });
},
async openExternal(path) {
    await sendRequest(MSG.FILE_OPEN_EXTERNAL, { path });
},
async revealInFinder(path) {
    await sendRequest(MSG.FILE_REVEAL, { path });
},
```

These methods throw on error (the existing `sendRequest` rejects with the backend error string).

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/file-store.ts
git commit -m "feat: add rename/delete/openExternal/reveal actions to file store"
```

### Task 6: Create RenameFileDialog component

**Files:**
- Create: `packages/ui/src/components/panels/RenameFileDialog.tsx`

- [ ] **Step 1: Create the dialog**

```typescript
import { useState, useEffect, useRef, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/file-store";

interface RenameFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filePath: string;
    isDirectory: boolean;
}

function RenameFileDialog({ open, onOpenChange, filePath, isDirectory }: RenameFileDialogProps) {
    const currentName = filePath.split("/").pop() ?? "";
    const parentDir = filePath.slice(0, filePath.length - currentName.length);
    const [name, setName] = useState(currentName);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const renameFile = useFileStore((s) => s.renameFile);

    useEffect(() => {
        if (open) {
            setName(currentName);
            setError(null);
            setSubmitting(false);
            // Auto-select name without extension for files
            requestAnimationFrame(() => {
                const input = inputRef.current;
                if (!input) return;
                input.focus();
                if (!isDirectory) {
                    const dotIndex = currentName.lastIndexOf(".");
                    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : currentName.length);
                } else {
                    input.select();
                }
            });
        }
    }, [open, currentName, isDirectory]);

    const validate = useCallback(
        (value: string): string | null => {
            const trimmed = value.trim();
            if (!trimmed) return "Name cannot be empty";
            if (trimmed.includes("/") || trimmed.includes("\0")) return "Name contains invalid characters";
            if (trimmed === currentName) return null; // same name = no-op, will just close
            return null;
        },
        [currentName],
    );

    const handleSubmit = async () => {
        const trimmed = name.trim();
        const validationError = validate(trimmed);
        if (validationError) {
            setError(validationError);
            return;
        }
        if (trimmed === currentName) {
            onOpenChange(false);
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await renameFile(filePath, parentDir + trimmed);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Rename failed");
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rename</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enter a new name for this {isDirectory ? "folder" : "file"}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                    <Input
                        ref={inputRef}
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={submitting}
                    />
                    {error && <p className="text-destructive text-sm">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={submitting}>
                        Rename
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { RenameFileDialog };
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panels/RenameFileDialog.tsx
git commit -m "feat: add RenameFileDialog component"
```

### Task 7: Create DeleteFileDialog component

**Files:**
- Create: `packages/ui/src/components/panels/DeleteFileDialog.tsx`

- [ ] **Step 1: Create the dialog**

```typescript
import { useState } from "react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useFileStore } from "@/stores/file-store";

interface DeleteFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filePath: string;
    isDirectory: boolean;
}

function DeleteFileDialog({ open, onOpenChange, filePath, isDirectory }: DeleteFileDialogProps) {
    const fileName = filePath.split("/").pop() ?? filePath;
    const [submitting, setSubmitting] = useState(false);
    const deleteFile = useFileStore((s) => s.deleteFile);

    const handleDelete = async () => {
        setSubmitting(true);
        try {
            await deleteFile(filePath);
            onOpenChange(false);
        } catch (e) {
            console.error("Delete failed:", e);
            onOpenChange(false);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete &ldquo;{fileName}&rdquo;{isDirectory ? " and all its contents" : ""}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        onClick={(e) => {
                            e.preventDefault();
                            void handleDelete();
                        }}
                        disabled={submitting}
                    >
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export { DeleteFileDialog };
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panels/DeleteFileDialog.tsx
git commit -m "feat: add DeleteFileDialog component"
```

### Task 8: Create FileContextMenu and integrate into FileTree

**Files:**
- Create: `packages/ui/src/components/panels/FileContextMenu.tsx`
- Modify: `packages/ui/src/components/panels/FileTree.tsx`

- [ ] **Step 1: Create FileContextMenu**

This component wraps children with a context menu trigger and manages the rename/delete dialog state.

```typescript
import { type ReactNode, useState, useCallback } from "react";
import {
    ContextMenu,
    ContextMenuTrigger,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Pencil, Trash2, Copy, FileText, FolderOpen, ExternalLink } from "lucide-react";
import { useFileStore } from "@/stores/file-store";
import { RenameFileDialog } from "./RenameFileDialog";
import { DeleteFileDialog } from "./DeleteFileDialog";

interface FileContextMenuProps {
    children: ReactNode;
    filePath: string;
    isDirectory: boolean;
    rootPath: string;
}

function FileContextMenu({ children, filePath, isDirectory, rootPath }: FileContextMenuProps) {
    const [renameOpen, setRenameOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const openExternal = useFileStore((s) => s.openExternal);
    const revealInFinder = useFileStore((s) => s.revealInFinder);

    const handleCopyPath = useCallback(() => {
        void navigator.clipboard.writeText(filePath);
    }, [filePath]);

    const handleCopyRelativePath = useCallback(() => {
        const relative = filePath.startsWith(rootPath + "/")
            ? filePath.slice(rootPath.length + 1)
            : filePath;
        void navigator.clipboard.writeText(relative);
    }, [filePath, rootPath]);

    const handleOpenExternal = useCallback(() => {
        void openExternal(filePath);
    }, [filePath, openExternal]);

    const handleReveal = useCallback(() => {
        void revealInFinder(filePath);
    }, [filePath, revealInFinder]);

    return (
        <>
            <ContextMenu>
                <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
                <ContextMenuContent>
                    <ContextMenuItem onSelect={() => setRenameOpen(true)}>
                        <Pencil />
                        Rename
                    </ContextMenuItem>
                    <ContextMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                        <Trash2 />
                        Delete
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onSelect={handleCopyPath}>
                        <Copy />
                        Copy Path
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={handleCopyRelativePath}>
                        <FileText />
                        Copy Relative Path
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    {!isDirectory && (
                        <ContextMenuItem onSelect={handleOpenExternal}>
                            <ExternalLink />
                            Open in External Editor
                        </ContextMenuItem>
                    )}
                    <ContextMenuItem onSelect={handleReveal}>
                        <FolderOpen />
                        Reveal in Finder
                    </ContextMenuItem>
                </ContextMenuContent>
            </ContextMenu>

            <RenameFileDialog
                open={renameOpen}
                onOpenChange={setRenameOpen}
                filePath={filePath}
                isDirectory={isDirectory}
            />
            <DeleteFileDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                filePath={filePath}
                isDirectory={isDirectory}
            />
        </>
    );
}

export { FileContextMenu };
```

- [ ] **Step 2: Integrate FileContextMenu into FileTree**

In `packages/ui/src/components/panels/FileTree.tsx`:

1. Add import: `import { FileContextMenu } from "./FileContextMenu";`
2. Add `rootPath` to `FileTreeProps`:

```typescript
interface FileTreeProps {
    node: FileNode;
    depth?: number;
    gitFiles?: Map<string, string>;
    onFileClick: (path: string) => void;
    expandedPaths?: Set<string> | null;
    rootPath?: string;
}
```

3. Update the function signature to accept and pass `rootPath`:

```typescript
function FileTree({ node, depth = 0, gitFiles, onFileClick, expandedPaths, rootPath }: FileTreeProps) {
```

4. Wrap the file `<div>` with `FileContextMenu`:

Replace the file return block:
```typescript
if (node.type === "file") {
    return (
        <FileContextMenu filePath={node.path} isDirectory={false} rootPath={rootPath ?? ""}>
            <div
                onClick={() => onFileClick(node.path)}
                draggable
                onDragStart={handleDragStart}
                className={fileClasses}
                style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
                title={node.path}
            >
                {node.name}
            </div>
        </FileContextMenu>
    );
}
```

5. For directories, wrap only the `<CollapsibleTrigger>` with `FileContextMenu` (not the entire `<Collapsible>`). `Collapsible` does not forward `onContextMenu` properly for `asChild` composition. The trigger element is the visible row that receives right-clicks:

```typescript
return (
    <Collapsible open={open} onOpenChange={setOpen}>
        <FileContextMenu filePath={node.path} isDirectory={true} rootPath={rootPath ?? ""}>
            <CollapsibleTrigger
                draggable
                onDragStart={handleDragStart}
                className="text-muted-foreground hover:bg-muted/50 flex w-full cursor-pointer items-center px-3 py-1 text-sm select-none"
                style={{ paddingLeft: Math.min(depth, 8) * 16 + 12 }}
            >
                {open ? (
                    <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" />
                ) : (
                    <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />
                )}
                {node.name}
            </CollapsibleTrigger>
        </FileContextMenu>
        <CollapsibleContent>
            {node.children?.map((child) => (
                <FileTree
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    gitFiles={gitFiles}
                    onFileClick={onFileClick}
                    expandedPaths={expandedPaths}
                    rootPath={rootPath}
                />
            ))}
        </CollapsibleContent>
    </Collapsible>
);
```

6. Pass `rootPath` through recursive children:

```typescript
<FileTree
    key={child.path}
    node={child}
    depth={depth + 1}
    gitFiles={gitFiles}
    onFileClick={onFileClick}
    expandedPaths={expandedPaths}
    rootPath={rootPath}
/>
```

- [ ] **Step 3: Pass rootPath from FileExplorer**

In `packages/ui/src/components/panels/FileExplorer.tsx`, add `rootPath={workingDir ?? ""}` to the `<FileTree>` call:

```typescript
<FileTree
    node={tree}
    gitFiles={gitFiles}
    onFileClick={handleFileClick}
    expandedPaths={expandedPaths}
    rootPath={workingDir ?? ""}
/>
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd packages/ui && bun run build`

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/panels/FileContextMenu.tsx packages/ui/src/components/panels/FileTree.tsx packages/ui/src/components/panels/FileExplorer.tsx
git commit -m "feat: add file context menu with rename, delete, copy path, reveal actions"
```

### Task 9: Run all tests

- [ ] **Step 1: Run backend tests**

Run: `cd packages/backend && bun test`

Expected: All tests pass including the new file handler tests.

- [ ] **Step 2: Run UI build**

Run: `cd packages/ui && bun run build`

Expected: Build succeeds.

- [ ] **Step 3: Manual smoke test**

1. Start the dev server
2. Open a project in Taskflow
3. Right-click a file in the file explorer — context menu should appear
4. Test each action: Rename, Delete, Copy Path, Copy Relative Path, Open in External Editor, Reveal in Finder
5. Verify tree refreshes after rename/delete
6. Verify rename dialog auto-selects name without extension
7. Verify delete shows correct message for files vs directories
8. Try renaming to an existing name — should show error
