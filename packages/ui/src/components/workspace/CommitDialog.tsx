import { useState, useCallback, useEffect, useRef } from "react";
import type {
    AgentType,
    GitCheckPrResult,
    BuiltinActionDefinition,
    BuiltinActionsListResponse,
    GitStatusResponse,
    GitStatusResult,
    GitCreatePrResult,
    GitCommitResult,
} from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS, MSG, renderPromptTemplate } from "@taskflow/shared";
import { openPullRequestUrl, pullRequestLabels } from "@/lib/pull-request-labels";
import { usePullRequestStore } from "@/stores/pull-request-store";
import { useWorkspaceRequest } from "@/hooks/useWorkspaceRequest";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceBackend } from "@/hooks/useWorkspaceBackend";
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

/**
 * The workspace machine's commit built-in, fetched fresh from that machine
 * (it may not be primary, whose store the Actions dialog manages). A machine
 * that predates built-in actions has no handler for the request; it gets the
 * default, which is what it ran before. Any other failure propagates, so a
 * transient error never silently replaces a configured override.
 */
async function loadCommitAction(
    request: <T>(type: string, payload?: unknown) => Promise<T>,
): Promise<BuiltinActionDefinition> {
    const fallback: BuiltinActionDefinition = {
        ...BUILTIN_ACTION_DEFAULTS["builtin:commit"],
        isModified: false,
    };
    try {
        const { actions } = await request<BuiltinActionsListResponse>(MSG.BUILTIN_ACTIONS_LIST);
        return actions.find((action) => action.id === "builtin:commit") ?? fallback;
    } catch (error) {
        // Router text for an unregistered type: packages/backend/src/ws/router.ts:18
        if (error instanceof Error && error.message.startsWith("No handler for message type")) {
            return fallback;
        }
        throw error;
    }
}

/**
 * A branch with no remote branch yet (a new task branch committed locally):
 * a request needs it pushed first. An older machine never reports upstreams.
 */
function isUnpublished(status: GitStatusResult): boolean {
    return status.hasUpstream === false && status.branch !== null;
}

export function CommitDialog({ open, onOpenChange, repoPath, sessionOwner }: CommitDialogProps) {
    // The commit agent runs on the workspace's machine, with that machine's defaults.
    const backendId = useWorkspaceBackend();
    // Git runs on that machine too.
    const request = useWorkspaceRequest();
    const defaultAgent = useSettingsStore(
        (s) => (backendId ? s.byBackend[backendId] : s.settings)?.general.defaultAgent ?? "claude",
    );
    const createSession = useSessionStore((s) => s.createSession);
    const checkPr = useCallback(
        (branch: string) => usePullRequestStore.getState().check(backendId ?? "", repoPath, branch),
        [backendId, repoPath],
    );
    return (
        <CommitDialogBody
            key={JSON.stringify([backendId, repoPath])}
            open={open}
            onOpenChange={onOpenChange}
            repoPath={repoPath}
            sessionOwner={sessionOwner}
            backendId={backendId}
            defaultAgent={defaultAgent}
            request={request}
            checkPr={checkPr}
            createSession={createSession}
        />
    );
}

export function CommitDialogBody({
    open,
    onOpenChange,
    repoPath,
    sessionOwner,
    backendId,
    defaultAgent,
    request,
    checkPr,
    createSession,
}: CommitDialogProps & {
    backendId: string | null;
    defaultAgent: AgentType;
    request<T>(type: string, payload?: unknown): Promise<T>;
    checkPr(branch: string): Promise<GitCheckPrResult>;
    createSession: ReturnType<typeof useSessionStore.getState>["createSession"];
}) {
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
    const [unpublished, setUnpublished] = useState(false);
    // The commit (and push) landed but the request did not; status alone
    // cannot tell when changes left out of the commit remain.
    const [requestPending, setRequestPending] = useState(false);

    const [branch, setBranch] = useState<string | null>(null);
    const [lookup, setLookup] = useState<GitCheckPrResult | null>(null);
    const [retry, setRetry] = useState(0);
    const generation = useRef(0);
    const labels = pullRequestLabels(lookup?.provider ?? null);
    const canCreate = lookup?.status === "none";

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
        setRequestPending(false);
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm],
    );

    // Status and lookup belong to this open dialog and machine only.
    useEffect(() => {
        const attempt = ++generation.current;
        setLookup(null);
        setBranch(null);
        setCreatePr(false);
        setHasChanges(null);
        setAhead(null);
        setUnpublished(false);
        if (!open) return;
        let active = true;
        void request<GitStatusResponse>(MSG.GIT_STATUS, { path: repoPath }).then(
            async (res) => {
                if (!active || generation.current !== attempt) return;
                const changed =
                    res.status.stagedFiles.length > 0 || res.status.unstagedFiles.length > 0;
                setHasChanges(changed);
                setHasStagedChanges(res.status.stagedFiles.length > 0);
                setAhead(res.status.ahead);
                setBehind(res.status.behind);
                setUnpublished(isUnpublished(res.status));
                setPush(!changed);
                setBranch(res.status.branch);
                const result: GitCheckPrResult = res.status.branch
                    ? await checkPr(res.status.branch).catch(() => ({
                          status: "unavailable" as const,
                          provider: null,
                          pr: null,
                          reason: "failed" as const,
                          message: "Pull request status is unavailable",
                      }))
                    : {
                          status: "unavailable",
                          provider: null,
                          pr: null,
                          reason: "failed",
                          message: "Cannot create a request from a detached HEAD",
                      };
                if (!active || generation.current !== attempt) return;
                setLookup(result);
                if (!changed && res.status.ahead === 0 && result.status === "none")
                    setCreatePr(true);
            },
            () => {
                if (!active || generation.current !== attempt) return;
                setHasChanges(true);
                setAhead(0);
                setLookup({
                    status: "unavailable",
                    provider: null,
                    pr: null,
                    reason: "failed",
                    message: "Pull request status is unavailable",
                });
            },
        );
        return () => {
            active = false;
        };
    }, [open, repoPath, backendId, request, checkPr, retry]);

    const handlePushChange = useCallback((checked: boolean) => {
        setPush(checked);
        if (!checked) setCreatePr(false);
    }, []);

    const taskId = "taskId" in sessionOwner ? sessionOwner.taskId : undefined;
    const prOnly = requestPending || (hasChanges === false && ahead === 0);
    const pushOnly = !prOnly && hasChanges === false && (ahead ?? 0) > 0;
    const commitButtonDisabled =
        (prOnly && !canCreate) || (!pushOnly && !prOnly && !includeUnstaged && !hasStagedChanges);

    const handleSubmit = useCallback(async () => {
        if (
            commitButtonDisabled ||
            hasChanges === null ||
            ahead === null ||
            ((createPr || prOnly) && !canCreate)
        )
            return;
        setError(null);
        setLoading(true);

        try {
            if (prOnly) {
                // PR-only mode — everything is committed; a branch never pushed is published first
                const prTitle = message.trim() || null;
                const title = prTitle ?? branch ?? "update";
                if (unpublished) await request(MSG.GIT_PUSH, { path: repoPath });
                await request<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                    path: repoPath,
                    title,
                    taskId,
                });
                handleOpenChange(false);
                return;
            }

            if (pushOnly) {
                // Push-only mode
                await request(MSG.GIT_PUSH, { path: repoPath });
                if (createPr) {
                    // Use current branch name or a generic title
                    const branchName = branch ?? "update";
                    await request<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                        path: repoPath,
                        title: branchName,
                        taskId,
                    });
                }
                handleOpenChange(false);
                return;
            }

            if (useAgent) {
                // Agent mode: create a new session with a prompt
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
                    parts.push(labels.agentInstruction);
                }
                const commitAction = await loadCommitAction(request);
                const prompt = renderPromptTemplate(commitAction.prompt, {
                    instructions: parts.join(" "),
                });
                // Options belong to the built-in's own agent; the default agent gets none.
                await createSession(
                    sessionOwner,
                    commitAction.sessionType ?? defaultAgent,
                    "Commit",
                    prompt,
                    undefined,
                    commitAction.sessionType ? commitAction.agentOptions : undefined,
                );
                handleOpenChange(false);
                return;
            }

            // Direct mode
            let commitMessage = message.trim();

            if (!commitMessage) {
                const result = await request<{ message: string }>(MSG.GIT_GENERATE_COMMIT_MSG, {
                    path: repoPath,
                    includeUnstaged,
                });
                commitMessage = result.message;
            }

            const commitResult = await request<GitCommitResult>(MSG.GIT_COMMIT, {
                path: repoPath,
                message: commitMessage,
                push,
                includeUnstaged,
            });

            if (createPr) {
                try {
                    await request<GitCreatePrResult>(MSG.GIT_CREATE_PR, {
                        path: repoPath,
                        title: commitResult.message,
                        taskId,
                    });
                } catch (err) {
                    setRequestPending(true);
                    setMessage(commitResult.message);
                    throw err;
                }
            }

            handleOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            // The failed step may follow ones that landed (the commit before
            // its push, the push before the request): when the repository
            // moved, read it again so a retry offers only what is left.
            void request<GitStatusResponse>(MSG.GIT_STATUS, { path: repoPath }).then(
                ({ status }) => {
                    const changed =
                        status.stagedFiles.length > 0 || status.unstagedFiles.length > 0;
                    if (
                        changed !== hasChanges ||
                        status.ahead !== ahead ||
                        isUnpublished(status) !== unpublished
                    )
                        setRetry((value) => value + 1);
                },
                () => {},
            );
        } finally {
            setLoading(false);
        }
    }, [
        commitButtonDisabled,
        hasChanges,
        ahead,
        unpublished,
        canCreate,
        branch,
        labels.agentInstruction,
        message,
        useAgent,
        defaultAgent,
        push,
        pushOnly,
        prOnly,
        createPr,
        includeUnstaged,
        repoPath,
        request,
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
        ? labels.create
        : pushOnly
          ? "Push"
          : push
            ? "Commit & Push"
            : "Commit";
    const dialogTitle = prOnly ? labels.title : pushOnly ? "Push" : "Commit & Push";

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
                                {labels.titleField}{" "}
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
                                dialogTitle={labels.titleField}
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

                                {useAgent && (
                                    <p className="text-muted-foreground ml-6 text-xs">
                                        Configured in Actions and Flows → Built-in
                                    </p>
                                )}

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
                                disabled={!push || !canCreate}
                            />
                            <Label
                                htmlFor="commit-create-pr"
                                className={`cursor-pointer tracking-normal normal-case ${!push ? "text-muted-foreground" : ""}`}>
                                {labels.create}
                            </Label>
                        </div>
                    )}

                    {lookup?.status === "found" && (
                        <a
                            href={lookup.pr.url}
                            onClick={(event) => {
                                event.preventDefault();
                                openPullRequestUrl(lookup.pr.url);
                            }}
                            className="text-accent text-sm">
                            {labels.short} {labels.short === "MR" ? "!" : "#"}
                            {lookup.pr.number} {lookup.pr.state}
                        </a>
                    )}
                    {lookup?.status === "unavailable" && (
                        <div className="text-muted-foreground text-sm">
                            <p>{lookup.message}</p>
                            <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
                                Retry
                            </Button>
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
                        tooltip={
                            commitButtonDisabled && !prOnly
                                ? "No staged changes to commit"
                                : undefined
                        }
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
