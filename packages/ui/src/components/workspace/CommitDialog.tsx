import { useState, useCallback, useEffect } from "react";
import type { GitStatusResponse, GitCreatePrResult, GitCommitResult } from "@taskflow/shared";
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
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type SessionOwner = { projectId: string } | { taskId: string };

interface CommitDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    repoPath: string;
    sessionOwner: SessionOwner;
}

export function CommitDialog({ open, onOpenChange, repoPath, sessionOwner }: CommitDialogProps) {
    const [message, setMessage] = useState("");
    const [useAgent, setUseAgent] = useState(false);
    const [push, setPush] = useState(false);
    const [createPr, setCreatePr] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasChanges, setHasChanges] = useState<boolean | null>(null);
    const [hasStagedChanges, setHasStagedChanges] = useState(false);
    const [includeUnstaged, setIncludeUnstaged] = useState(true);
    const [ahead, setAhead] = useState<number | null>(null);
    const [behind, setBehind] = useState(0);

    const createSession = useSessionStore((s) => s.createSession);

    const resetForm = useCallback(() => {
        setMessage("");
        setUseAgent(false);
        setPush(false);
        setCreatePr(false);
        setLoading(false);
        setError(null);
        setHasChanges(null);
        setHasStagedChanges(false);
        setIncludeUnstaged(true);
        setAhead(null);
        setBehind(0);
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm],
    );

    // Fetch git status when dialog opens to determine mode
    useEffect(() => {
        if (!open) return;
        sendRequest<GitStatusResponse>(MSG.GIT_STATUS, { path: repoPath }).then(
            (res) => {
                const changed =
                    res.status.stagedFiles.length > 0 || res.status.unstagedFiles.length > 0;
                setHasChanges(changed);
                setHasStagedChanges(res.status.stagedFiles.length > 0);
                setAhead(res.status.ahead);
                setBehind(res.status.behind);
                // In push-only mode, push is always on
                if (!changed) setPush(true);
                // In PR-only mode, enable create PR by default
                if (!changed && res.status.ahead === 0) setCreatePr(true);
            },
            () => setHasChanges(true), // Assume changes on error
        );
    }, [open, repoPath]);

    const handlePushChange = useCallback((checked: boolean) => {
        setPush(checked);
        if (!checked) setCreatePr(false);
    }, []);

    const taskId = "taskId" in sessionOwner ? sessionOwner.taskId : undefined;
    const pushOnly = hasChanges === false && (ahead ?? 0) > 0;
    const prOnly = hasChanges === false && ahead === 0;
    const commitButtonDisabled = !pushOnly && !prOnly && !includeUnstaged && !hasStagedChanges;

    const handleSubmit = useCallback(async () => {
        setError(null);
        setLoading(true);

        try {
            if (prOnly) {
                // PR-only mode — everything is committed and pushed
                const prTitle = message.trim() || null;
                const status = await sendRequest<GitStatusResponse>(MSG.GIT_STATUS, {
                    path: repoPath,
                });
                const title = prTitle ?? status.status.branch ?? "update";
                await sendRequest<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                    path: repoPath,
                    title,
                    taskId,
                });
                handleOpenChange(false);
                return;
            }

            if (pushOnly) {
                // Push-only mode
                await sendRequest(MSG.GIT_PUSH, { path: repoPath });
                if (createPr) {
                    // Use current branch name or a generic title
                    const status = await sendRequest<GitStatusResponse>(MSG.GIT_STATUS, {
                        path: repoPath,
                    });
                    const branchName = status.status.branch ?? "update";
                    await sendRequest<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                        path: repoPath,
                        title: branchName,
                        taskId,
                    });
                }
                handleOpenChange(false);
                return;
            }

            if (useAgent) {
                // Agent mode: create a new claude session with a prompt
                const parts: string[] = [
                    includeUnstaged
                        ? "Create commits for all changes, staged and unstaged."
                        : "Create commits for staged changes only.",
                ];
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
                    await createSession(sessionOwner, "claude", "Commit", prompt);
                } catch {
                    await createSession(sessionOwner, "codex", "Commit", prompt);
                }
                handleOpenChange(false);
                return;
            }

            // Direct mode
            let commitMessage = message.trim();

            if (!commitMessage) {
                const result = await sendRequest<{ message: string }>(MSG.GIT_GENERATE_COMMIT_MSG, {
                    path: repoPath,
                    includeUnstaged,
                });
                commitMessage = result.message;
            }

            const commitResult = await sendRequest<GitCommitResult>(MSG.GIT_COMMIT, {
                path: repoPath,
                message: commitMessage,
                push,
                includeUnstaged,
            });

            if (createPr) {
                await sendRequest<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                    path: repoPath,
                    title: commitResult.message,
                    taskId,
                });
            }

            handleOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [
        message,
        useAgent,
        push,
        pushOnly,
        prOnly,
        createPr,
        includeUnstaged,
        repoPath,
        taskId,
        sessionOwner,
        createSession,
        handleOpenChange,
    ]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [loading, handleSubmit],
    );

    const submitLabel = prOnly
        ? "Create PR"
        : pushOnly
          ? "Push"
          : push
            ? "Commit & Push"
            : "Commit";
    const dialogTitle = prOnly ? "Create Pull Request" : pushOnly ? "Push" : "Commit & Push";

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>{dialogTitle}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    {prOnly && (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="pr-title">
                                Title{" "}
                                <span className="text-muted-foreground/60 text-xs tracking-normal normal-case">
                                    (optional — defaults to branch name)
                                </span>
                            </Label>
                            <ExpandableTextarea
                                id="pr-title"
                                placeholder="Leave empty to use branch name..."
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                className="max-h-40 min-h-20"
                                dialogTitle="PR Title"
                            />
                        </div>
                    )}

                    {!pushOnly && !prOnly && (
                        <>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="commit-message">
                                    Message{" "}
                                    <span className="text-muted-foreground/60 text-xs tracking-normal normal-case">
                                        (optional — auto-generated if empty)
                                    </span>
                                </Label>
                                <ExpandableTextarea
                                    id="commit-message"
                                    placeholder="Leave empty to auto-generate..."
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    className="max-h-40 min-h-20"
                                    dialogTitle="Commit Message"
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
                                        className="cursor-pointer tracking-normal normal-case">
                                        Use agent
                                    </Label>
                                </div>

                                <div className="flex items-center gap-2">
                                    <Switch
                                        id="commit-include-unstaged"
                                        checked={includeUnstaged}
                                        onCheckedChange={setIncludeUnstaged}
                                    />
                                    <Label
                                        htmlFor="commit-include-unstaged"
                                        className="cursor-pointer tracking-normal normal-case">
                                        Include unstaged changes
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
                                        className="cursor-pointer tracking-normal normal-case">
                                        Push
                                    </Label>
                                </div>
                            </div>
                        </>
                    )}

                    {!prOnly && (
                        <div className="flex items-center gap-2">
                            <Switch
                                id="commit-create-pr"
                                checked={createPr}
                                onCheckedChange={setCreatePr}
                                disabled={!push}
                            />
                            <Label
                                htmlFor="commit-create-pr"
                                className={`cursor-pointer tracking-normal normal-case ${!push ? "text-muted-foreground" : ""}`}>
                                Create PR
                            </Label>
                        </div>
                    )}

                    {behind > 0 && (
                        <p className="text-info text-sm">
                            There {behind === 1 ? "is" : "are"} {behind} remote{" "}
                            {behind === 1 ? "commit" : "commits"}. Pull before committing.
                        </p>
                    )}

                    {error && <p className="text-destructive text-sm">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleSubmit()}
                        loading={loading || hasChanges === null || ahead === null}
                        disabled={commitButtonDisabled}
                        tooltip={commitButtonDisabled ? "No staged changes to commit" : undefined}
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
