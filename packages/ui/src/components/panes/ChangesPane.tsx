import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cva } from "class-variance-authority";
import type { GitStatusResult, GitFileStatus } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { confirm } from "@/stores/dialog-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

type BadgeColorScheme = "claude" | "codex" | "active" | "archived";

const diffLineVariants = cva("font-mono text-sm leading-relaxed whitespace-pre-wrap", {
    variants: {
        type: {
            added: "text-success",
            removed: "text-destructive",
            hunk: "text-accent",
            context: "text-secondary-foreground",
        },
    },
    defaultVariants: {
        type: "context",
    },
});

function getDiffLineType(line: string): "added" | "removed" | "hunk" | "context" {
    if (line.startsWith("+")) return "added";
    if (line.startsWith("-")) return "removed";
    if (line.startsWith("@@")) return "hunk";
    return "context";
}

function gitStatusToColorScheme(status: GitFileStatus["status"]): BadgeColorScheme | undefined {
    if (status === "new" || status === "untracked") return "claude";
    if (status === "modified") return "codex";
    return undefined;
}

function statusPrefix(status: GitFileStatus["status"]): string {
    if (status === "new" || status === "untracked") return "+";
    if (status === "modified") return "M";
    if (status === "deleted") return "D";
    if (status === "renamed") return "R";
    return "?";
}

function displayPath(file: GitFileStatus): string {
    return file.status === "renamed" && file.previousPath
        ? `${file.previousPath} -> ${file.path}`
        : file.path;
}

interface FileStatusRowProps {
    file: GitFileStatus;
    isSelected: boolean;
    onSelect: (path: string) => void;
    onRevert: (file: GitFileStatus) => void;
}

function FileStatusRow({ file, isSelected, onSelect, onRevert }: FileStatusRowProps) {
    const rowClasses = useMemo(
        () =>
            cn(
                "flex justify-between items-center px-1 py-0.5 cursor-pointer rounded-md text-sm",
                isSelected && "bg-muted",
            ),
        [isSelected],
    );

    const badgeClasses = useMemo(
        () =>
            cn(
                "text-xs px-1 py-0 font-mono",
                file.status === "deleted" && "text-destructive border-destructive/30",
            ),
        [file.status],
    );

    return (
        <div onClick={() => onSelect(file.path)} className={rowClasses}>
            <span className="flex items-center gap-1.5">
                <Badge
                    variant="outline"
                    colorScheme={gitStatusToColorScheme(file.status)}
                    className={badgeClasses}
                >
                    {statusPrefix(file.status)}
                </Badge>
                <span className="text-secondary-foreground">{displayPath(file)}</span>
            </span>
            <Button
                variant="ghost"
                size="icon-sm"
                className="text-destructive h-5 w-5"
                aria-label="Revert change"
                tooltip="Revert change"
                onClick={(e) => {
                    e.stopPropagation();
                    onRevert(file);
                }}
            >
                <Undo2 className="h-3 w-3" />
            </Button>
        </div>
    );
}

interface ChangesPaneProps {
    repoPath: string;
    className?: string;
}

function ChangesPane({ repoPath, className }: ChangesPaneProps) {
    const [status, setStatus] = useState<GitStatusResult | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [diff, setDiff] = useState<string | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const repoVersionRef = useRef(0);
    const diffRequestIdRef = useRef(0);

    const containerClasses = useMemo(
        () => cn("flex-1 flex flex-col overflow-hidden", className),
        [className],
    );

    const fetchStatus = useCallback(
        async (repoVersion = repoVersionRef.current) => {
            try {
                const { status } = await sendRequest<{ status: GitStatusResult }>(MSG.GIT_STATUS, {
                    path: repoPath,
                });
                if (repoVersion !== repoVersionRef.current) return;
                setStatus(status);
            } catch (err: unknown) {
                if (repoVersion !== repoVersionRef.current) return;
                console.error("Failed to fetch git status:", err);
            }
        },
        [repoPath],
    );

    useEffect(() => {
        const repoVersion = ++repoVersionRef.current;
        diffRequestIdRef.current += 1;
        setSelectedFile(null);
        setDiff(null);
        setDiffLoading(false);
        void fetchStatus(repoVersion);
    }, [repoPath, fetchStatus]);

    async function showDiff(filePath: string) {
        const repoVersion = repoVersionRef.current;
        const requestId = ++diffRequestIdRef.current;
        setSelectedFile(filePath);
        setDiff(null);
        setDiffLoading(true);
        try {
            const { diff } = await sendRequest<{ diff: string }>(MSG.GIT_DIFF_FILE, {
                repoPath,
                filePath,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            setDiff(diff);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            console.error("Failed to fetch diff:", err);
            setDiff(null);
        } finally {
            if (repoVersion === repoVersionRef.current && requestId === diffRequestIdRef.current) {
                setDiffLoading(false);
            }
        }
    }

    async function revertFile(file: GitFileStatus) {
        const repoVersion = repoVersionRef.current;
        await confirm({
            title: "Revert File",
            description: `Revert all changes to ${file.path}? This cannot be undone.`,
            confirmLabel: "Revert",
            variant: "destructive",
            onConfirm: async () => {
                await sendRequest(MSG.GIT_REVERT_FILE, {
                    repoPath,
                    filePath: file.path,
                    status: file.status,
                    previousPath: file.previousPath,
                });
                await fetchStatus(repoVersion);
                if (repoVersion !== repoVersionRef.current) return;
                if (selectedFile === file.path) {
                    setSelectedFile(null);
                    setDiff(null);
                    setDiffLoading(false);
                }
            },
        });
    }

    return (
        <div className={containerClasses}>
            {/* File list */}
            <ScrollArea className="border-border max-h-[40%] border-b p-3">
                {status?.branch && (
                    <div className="mb-1.5">
                        <Badge variant="outline" className="text-xs">
                            {status.branch}
                        </Badge>
                    </div>
                )}
                {status?.files.length === 0 && (
                    <div className="text-muted-foreground text-sm">No changes</div>
                )}
                {status?.files.map((file) => (
                    <FileStatusRow
                        key={file.path}
                        file={file}
                        isSelected={file.path === selectedFile}
                        onSelect={showDiff}
                        onRevert={revertFile}
                    />
                ))}
            </ScrollArea>

            {/* Diff view */}
            <ScrollArea className="flex-1 p-3">
                {diffLoading ? (
                    <div className="text-muted-foreground text-sm">Loading diff...</div>
                ) : diff ? (
                    <pre className="m-0">
                        {diff.split("\n").map((line, i) => (
                            <div
                                key={i}
                                className={diffLineVariants({ type: getDiffLineType(line) })}
                            >
                                {line}
                            </div>
                        ))}
                    </pre>
                ) : selectedFile ? (
                    <div className="text-muted-foreground text-sm">
                        No textual diff available for this file
                    </div>
                ) : (
                    <div className="text-muted-foreground text-sm">
                        Click a file to see its diff
                    </div>
                )}
            </ScrollArea>
        </div>
    );
}

export { ChangesPane };
export type { ChangesPaneProps };
