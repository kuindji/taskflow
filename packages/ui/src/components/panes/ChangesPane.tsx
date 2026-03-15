import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cva } from "class-variance-authority";
import type { GitStatusResult, GitFileStatus } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { confirm } from "@/stores/dialog-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Undo2, Plus, Minus, ChevronDown, ChevronRight } from "lucide-react";
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
    onRevert?: (file: GitFileStatus) => void;
    onStageToggle?: (file: GitFileStatus) => void;
    staged: boolean;
}

function FileStatusRow({
    file,
    isSelected,
    onSelect,
    onRevert,
    onStageToggle,
    staged,
}: FileStatusRowProps) {
    const rowClasses = useMemo(
        () =>
            cn(
                "flex justify-between items-center px-1 py-0.5 cursor-pointer rounded-md text-sm group",
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
            <span className="flex min-w-0 items-center gap-1.5">
                <Badge
                    variant="outline"
                    colorScheme={gitStatusToColorScheme(file.status)}
                    className={badgeClasses}
                >
                    {statusPrefix(file.status)}
                </Badge>
                <span className="text-secondary-foreground truncate">{displayPath(file)}</span>
            </span>
            <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {!staged && onRevert && (
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
                )}
                {onStageToggle && (
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-5 w-5"
                        aria-label={staged ? "Unstage file" : "Stage file"}
                        tooltip={staged ? "Unstage file" : "Stage file"}
                        onClick={(e) => {
                            e.stopPropagation();
                            onStageToggle(file);
                        }}
                    >
                        {staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    </Button>
                )}
            </span>
        </div>
    );
}

interface SectionHeaderProps {
    label: string;
    count: number;
    collapsed: boolean;
    onToggle: () => void;
    action?: { label: string; onClick: () => void };
}

function SectionHeader({ label, count, collapsed, onToggle, action }: SectionHeaderProps) {
    return (
        <div className="flex items-center justify-between px-1 py-1">
            <button
                onClick={onToggle}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium transition-colors"
            >
                {collapsed ? (
                    <ChevronRight className="h-3 w-3" />
                ) : (
                    <ChevronDown className="h-3 w-3" />
                )}
                {label} ({count})
            </button>
            {action && count > 0 && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-xs"
                    onClick={action.onClick}
                >
                    {action.label}
                </Button>
            )}
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
    const [diff, setDiff] = useState<{ staged?: string; unstaged?: string } | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [stagedCollapsed, setStagedCollapsed] = useState(false);
    const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);
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
            const result = await sendRequest<{ staged?: string; unstaged?: string }>(
                MSG.GIT_DIFF_FILE,
                {
                    repoPath,
                    filePath,
                },
            );
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            setDiff(result);
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

    async function stageFile(file: GitFileStatus) {
        try {
            await sendRequest(MSG.GIT_STAGE, { repoPath, filePath: file.path });
            await fetchStatus();
            if (selectedFile === file.path) void showDiff(file.path);
        } catch (err) {
            console.error("Failed to stage file:", err);
        }
    }

    async function unstageFile(file: GitFileStatus) {
        try {
            await sendRequest(MSG.GIT_UNSTAGE, { repoPath, filePath: file.path });
            await fetchStatus();
            if (selectedFile === file.path) void showDiff(file.path);
        } catch (err) {
            console.error("Failed to unstage file:", err);
        }
    }

    async function stageAll() {
        try {
            await sendRequest(MSG.GIT_STAGE, { repoPath });
            await fetchStatus();
            if (selectedFile) void showDiff(selectedFile);
        } catch (err) {
            console.error("Failed to stage all files:", err);
        }
    }

    async function unstageAll() {
        try {
            await sendRequest(MSG.GIT_UNSTAGE, { repoPath });
            await fetchStatus();
            if (selectedFile) void showDiff(selectedFile);
        } catch (err) {
            console.error("Failed to unstage all files:", err);
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

    const hasNoChanges =
        status && status.stagedFiles.length === 0 && status.unstagedFiles.length === 0;

    return (
        <div className={containerClasses}>
            {/* File list */}
            <div className="border-border max-h-[40%] overflow-y-auto border-b p-3">
                {status?.branch && (
                    <div className="mb-1.5">
                        <Badge variant="outline" className="text-xs">
                            {status.branch}
                        </Badge>
                    </div>
                )}
                {hasNoChanges && <div className="text-muted-foreground text-sm">No changes</div>}

                {status && status.stagedFiles.length > 0 && (
                    <>
                        <SectionHeader
                            label="Staged Changes"
                            count={status.stagedFiles.length}
                            collapsed={stagedCollapsed}
                            onToggle={() => setStagedCollapsed((v) => !v)}
                            action={{ label: "Unstage All", onClick: () => void unstageAll() }}
                        />
                        {!stagedCollapsed &&
                            status.stagedFiles.map((file) => (
                                <FileStatusRow
                                    key={`staged-${file.path}`}
                                    file={file}
                                    staged
                                    isSelected={file.path === selectedFile}
                                    onSelect={showDiff}
                                    onStageToggle={unstageFile}
                                />
                            ))}
                    </>
                )}

                {status && status.unstagedFiles.length > 0 && (
                    <>
                        <SectionHeader
                            label="Unstaged Changes"
                            count={status.unstagedFiles.length}
                            collapsed={unstagedCollapsed}
                            onToggle={() => setUnstagedCollapsed((v) => !v)}
                            action={{ label: "Stage All", onClick: () => void stageAll() }}
                        />
                        {!unstagedCollapsed &&
                            status.unstagedFiles.map((file) => (
                                <FileStatusRow
                                    key={`unstaged-${file.path}`}
                                    file={file}
                                    staged={false}
                                    isSelected={file.path === selectedFile}
                                    onSelect={showDiff}
                                    onRevert={revertFile}
                                    onStageToggle={stageFile}
                                />
                            ))}
                    </>
                )}
            </div>

            {/* Diff view */}
            <div className="flex-1 overflow-y-auto p-3">
                {diffLoading ? (
                    <div className="text-muted-foreground text-sm">Loading diff...</div>
                ) : diff && (diff.staged || diff.unstaged) ? (
                    <pre className="m-0">
                        {diff.staged && (
                            <>
                                <div className="text-accent bg-accent/10 mb-1 rounded px-1 py-0.5 text-xs font-semibold">
                                    Staged Changes
                                </div>
                                {diff.staged.split("\n").map((line, i) => (
                                    <div
                                        key={`staged-${i}`}
                                        className={diffLineVariants({
                                            type: getDiffLineType(line),
                                        })}
                                    >
                                        {line}
                                    </div>
                                ))}
                            </>
                        )}
                        {diff.staged && diff.unstaged && (
                            <div className="border-border my-2 border-t" />
                        )}
                        {diff.unstaged && (
                            <>
                                <div className="text-muted-foreground bg-muted mb-1 rounded px-1 py-0.5 text-xs font-semibold">
                                    Unstaged Changes
                                </div>
                                {diff.unstaged.split("\n").map((line, i) => (
                                    <div
                                        key={`unstaged-${i}`}
                                        className={diffLineVariants({
                                            type: getDiffLineType(line),
                                        })}
                                    >
                                        {line}
                                    </div>
                                ))}
                            </>
                        )}
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
            </div>
        </div>
    );
}

export { ChangesPane };
export type { ChangesPaneProps };
