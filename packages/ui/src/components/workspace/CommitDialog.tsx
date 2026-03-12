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
