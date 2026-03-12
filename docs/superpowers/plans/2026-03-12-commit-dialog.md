# Commit Dialog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a commit dialog to the project header that supports direct git commit/push/PR and agent-delegated commits.

**Architecture:** New `CommitDialog` component triggered from `TaskHeader`. Direct mode uses three new WebSocket messages (`GIT_COMMIT`, `GIT_GENERATE_COMMIT_MSG`, `GIT_CREATE_PR`) handled by the backend `GitService`. Agent mode creates a new claude/codex session with a constructed prompt.

**Tech Stack:** React, Radix UI Dialog/Switch, Zustand, Bun.spawn for git/gh CLI, WebSocket request/response pattern.

---

## Chunk 1: Shared Types and Constants

### Task 1: Add message types and payload/result interfaces

**Files:**
- Modify: `packages/shared/src/constants.ts:43-48` (Git section of MSG)
- Modify: `packages/shared/src/types/ws.ts:244` (after `GitWorktreeCreatePayload`)

- [ ] **Step 1: Add new MSG constants**

In `packages/shared/src/constants.ts`, add three entries at the end of the `// Git` section (after line 48, `GIT_WORKTREE_CREATE`):

```typescript
    GIT_COMMIT: "git:commit",
    GIT_GENERATE_COMMIT_MSG: "git:generate-commit-msg",
    GIT_CREATE_PR: "git:create-pr",
```

- [ ] **Step 2: Add payload and result types to ws.ts**

In `packages/shared/src/types/ws.ts`, add after the `GitWorktreeCreatePayload` interface (after line 244):

```typescript
export interface GitCommitPayload {
    path: string;
    message: string;
    push: boolean;
}

export interface GitCommitResult {
    hash: string;
    message: string;
}

export interface GitCreatePrPayload {
    path: string;
    title: string;
    body?: string;
}

export interface GitCreatePrResult {
    url: string;
}
```

- [ ] **Step 3: Verify the build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/shared' build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add git commit/PR message types and payload interfaces"
```

---

## Chunk 2: Backend Git Service Methods

### Task 2: Add commit, createPr, and generateCommitMessage to GitService

**Files:**
- Modify: `packages/backend/src/services/git-service.ts:196` (end of class)

- [ ] **Step 1: Add `commit` method**

Add to the `GitService` class, after the `createWorktree` method (line 195):

```typescript
    async commit(repoPath: string, message: string, push: boolean): Promise<{ hash: string; message: string }> {
        await git(["add", "-A"], repoPath);
        await git(["commit", "-m", message], repoPath);
        const hashOutput = await git(["rev-parse", "--short", "HEAD"], repoPath);
        if (push) {
            await git(["push"], repoPath);
        }
        return { hash: hashOutput.trim(), message };
    }
```

- [ ] **Step 2: Add `createPr` method**

Add after `commit`:

```typescript
    async createPr(repoPath: string, title: string, body?: string): Promise<{ url: string }> {
        const args = ["pr", "create", "--title", title];
        if (body) {
            args.push("--body", body);
        } else {
            args.push("--body", "");
        }
        const proc = Bun.spawn(["gh", ...args], { cwd: repoPath, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || stdout.trim() || `gh pr create failed with exit code ${exitCode}`);
        }
        return { url: stdout.trim() };
    }
```

- [ ] **Step 3: Add `generateCommitMessage` method**

Add after `createPr`. This spawns a short-lived `claude` process to generate a commit message from the diff:

```typescript
    async generateCommitMessage(repoPath: string): Promise<string> {
        const diffResult = await this.diff(repoPath);
        const diffText = diffResult.files.map((f) => f.diff).join("\n");
        if (!diffText.trim()) {
            throw new Error("No changes to commit");
        }

        const prompt = [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            diffText,
        ].join("\n");

        const env = { ...process.env } as Record<string, string>;
        delete env.CLAUDECODE;
        delete env.CLAUDE_CODE_ENTRYPOINT;

        const proc = Bun.spawn(
            ["claude", "-p", prompt],
            { cwd: repoPath, stdout: "pipe", stderr: "pipe", env },
        );
        const [stdout, , exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        if (exitCode !== 0 || !stdout.trim()) {
            throw new Error("Failed to generate commit message");
        }
        return stdout.trim();
    }
```

- [ ] **Step 4: Verify the build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/backend' build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/git-service.ts
git commit -m "feat: add commit, createPr, and generateCommitMessage to GitService"
```

---

### Task 3: Add backend handlers for new git messages

**Files:**
- Modify: `packages/backend/src/handlers/git.ts:1-9` (imports)
- Modify: `packages/backend/src/handlers/git.ts:69` (end of `registerGitHandlers`)

- [ ] **Step 1: Update imports**

In `packages/backend/src/handlers/git.ts`, add the new payload types to the import block (line 3-8):

```typescript
import type {
    GitStatusPayload,
    GitDiffPayload,
    GitDiffFilePayload,
    GitRevertFilePayload,
    GitWorktreeCreatePayload,
    GitCommitPayload,
    GitCreatePrPayload,
} from "@taskflow/shared";
```

- [ ] **Step 2: Add handlers**

Add before the closing `}` of `registerGitHandlers` (before line 69):

```typescript
    router.register(MSG.GIT_COMMIT, async (payload) => {
        const { path, message, push } = payload as GitCommitPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return await git.commit(repoPath, message, push);
    });

    router.register(MSG.GIT_GENERATE_COMMIT_MSG, async (payload) => {
        const { path } = payload as GitStatusPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const message = await git.generateCommitMessage(repoPath);
        return { message };
    });

    router.register(MSG.GIT_CREATE_PR, async (payload) => {
        const { path, title, body } = payload as GitCreatePrPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        return await git.createPr(repoPath, title, body);
    });
```

- [ ] **Step 3: Verify the build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/backend' build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/git.ts
git commit -m "feat: add handlers for git commit, generate commit msg, and create PR"
```

---

## Chunk 3: Commit Dialog UI Component

### Task 4: Create the CommitDialog component

**Files:**
- Create: `packages/ui/src/components/workspace/CommitDialog.tsx`

- [ ] **Step 1: Create the component file**

Create `packages/ui/src/components/workspace/CommitDialog.tsx`:

```tsx
import { useState, useCallback } from "react";
import type { Project } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { useSessionStore } from "@/stores/session-store";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface CommitDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project;
}

export function CommitDialog({ open, onOpenChange, project }: CommitDialogProps) {
    const [message, setMessage] = useState("");
    const [useAgent, setUseAgent] = useState(false);
    const [push, setPush] = useState(false);
    const [createPr, setCreatePr] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const createSession = useSessionStore((s) => s.createSession);

    const resetForm = useCallback(() => {
        setMessage("");
        setUseAgent(false);
        setPush(false);
        setCreatePr(false);
        setLoading(false);
        setError(null);
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm],
    );

    const handlePushChange = useCallback((checked: boolean) => {
        setPush(checked);
        if (!checked) setCreatePr(false);
    }, []);

    const handleSubmit = useCallback(async () => {
        setError(null);
        setLoading(true);

        try {
            if (useAgent) {
                // Agent mode: create a new claude session with a prompt
                const parts: string[] = ["Commit the current changes."];
                if (message.trim()) {
                    parts.push(`Commit message hint: ${message.trim()}`);
                }
                if (push) {
                    parts.push("Push to remote after committing.");
                }
                if (createPr) {
                    parts.push("Create a pull request after pushing.");
                }
                const prompt = parts.join(" ");

                try {
                    await createSession(
                        { projectId: project.id },
                        "claude",
                        "Commit",
                        prompt,
                    );
                } catch {
                    await createSession(
                        { projectId: project.id },
                        "codex",
                        "Commit",
                        prompt,
                    );
                }
                handleOpenChange(false);
                return;
            }

            // Direct mode
            let commitMessage = message.trim();

            if (!commitMessage) {
                const result = await sendRequest<{ message: string }>(
                    MSG.GIT_GENERATE_COMMIT_MSG,
                    { path: project.path },
                );
                commitMessage = result.message;
            }

            const commitResult = await sendRequest<{ hash: string; message: string }>(
                MSG.GIT_COMMIT,
                { path: project.path, message: commitMessage, push },
            );

            if (createPr) {
                await sendRequest<{ url: string }>(
                    MSG.GIT_CREATE_PR,
                    { path: project.path, title: commitResult.message },
                );
            }

            handleOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [message, useAgent, push, createPr, project, createSession, handleOpenChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [loading, handleSubmit],
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>Commit</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="commit-message">
                            Message{" "}
                            <span className="text-muted-foreground/60 text-xs tracking-normal normal-case">
                                (optional — auto-generated if empty)
                            </span>
                        </Label>
                        <Textarea
                            id="commit-message"
                            placeholder="Leave empty to auto-generate..."
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className="max-h-40 min-h-20"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="commit-use-agent"
                                checked={useAgent}
                                onCheckedChange={setUseAgent}
                            />
                            <Label
                                htmlFor="commit-use-agent"
                                className="cursor-pointer tracking-normal normal-case"
                            >
                                Use agent
                            </Label>
                        </div>

                        <div className="flex items-center gap-2">
                            <Switch
                                id="commit-push"
                                checked={push}
                                onCheckedChange={handlePushChange}
                            />
                            <Label
                                htmlFor="commit-push"
                                className="cursor-pointer tracking-normal normal-case"
                            >
                                Push
                            </Label>
                        </div>

                        <div className="flex items-center gap-2">
                            <Switch
                                id="commit-create-pr"
                                checked={createPr}
                                onCheckedChange={setCreatePr}
                                disabled={!push}
                            />
                            <Label
                                htmlFor="commit-create-pr"
                                className={`cursor-pointer tracking-normal normal-case ${!push ? "text-muted-foreground" : ""}`}
                            >
                                Create PR
                            </Label>
                        </div>
                    </div>

                    {error && (
                        <p className="text-destructive text-sm">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleSubmit()}
                        loading={loading}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                        Commit
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/ui' build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/CommitDialog.tsx
git commit -m "feat: add CommitDialog component with direct and agent modes"
```

---

## Chunk 4: Wire CommitDialog into TaskHeader

### Task 5: Add commit button to TaskHeader and wire up the dialog

**Files:**
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx:1-22` (imports)
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx:30-46` (state/refs)
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx:157-177` (before diff button)
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx:228-236` (dialog render)

- [ ] **Step 1: Add imports**

In `TaskHeader.tsx`, add to the lucide-react import (line 13-21):

Add `GitCommitHorizontal` to the lucide-react import list (after `PanelRightOpen`).

Add the CommitDialog import after the RenameProjectDialog import (after line 12):

```typescript
import { CommitDialog } from "./CommitDialog";
```

- [ ] **Step 2: Add commit dialog state**

After the `const [renameOpen, setRenameOpen] = useState(false);` line (line 40), add:

```typescript
const [commitOpen, setCommitOpen] = useState(false);
```

- [ ] **Step 3: Add showCommitButton condition**

After the `showDiffButton` line (line 46), add:

```typescript
const showCommitButton = !task && !!project;
```

- [ ] **Step 4: Add commit button before the diff button**

In the JSX, just before the `{showDiffButton && (` block (before line 157), add:

```tsx
                    {showCommitButton && (
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setCommitOpen(true)}
                            aria-label="Commit"
                            className="[-webkit-app-region:no-drag]"
                        >
                            <GitCommitHorizontal className="h-3 w-3" />
                            <span className="text-xs">Commit</span>
                        </Button>
                    )}
```

- [ ] **Step 5: Add CommitDialog render**

After the `RenameProjectDialog` render block (after line 235, before the closing `</div>`), add:

```tsx
            {project && (
                <CommitDialog
                    open={commitOpen}
                    onOpenChange={setCommitOpen}
                    project={project}
                />
            )}
```

- [ ] **Step 6: Verify the build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/ui' build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/workspace/TaskHeader.tsx
git commit -m "feat: add commit button to project header and wire CommitDialog"
```
