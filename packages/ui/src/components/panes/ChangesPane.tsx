import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitStatusResult, GitFileStatus, GitDiffFileContentResult } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { confirm } from "@/stores/dialog-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Undo2, Plus, Minus, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLanguage } from "@/lib/editor-language";
import { MonacoDiffViewer } from "./MonacoDiffViewer";

type BadgeColorScheme = "claude" | "codex" | "gemini" | "active" | "archived";

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
                "flex justify-between items-center px-1 py-0.5 cursor-pointer rounded-md text-sm group transition-colors hover:bg-muted/60",
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

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(file.path);
            }
        },
        [onSelect, file.path],
    );

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(file.path)}
            onKeyDown={handleKeyDown}
            className={rowClasses}>
            <span className="flex min-w-0 items-center gap-1.5">
                <Badge
                    variant="outline"
                    colorScheme={gitStatusToColorScheme(file.status)}
                    className={badgeClasses}>
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
                        }}>
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
                        }}>
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
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium transition-colors">
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
                    onClick={action.onClick}>
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
    const [diffContent, setDiffContent] = useState<GitDiffFileContentResult | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [diffTab, setDiffTab] = useState<"staged" | "unstaged">("unstaged");
    const [stagedCollapsed, setStagedCollapsed] = useState(false);
    const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);
    const repoVersionRef = useRef(0);
    const diffRequestIdRef = useRef(0);

    const containerClasses = useMemo(
        () => cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", className),
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
        setDiffContent(null);
        setDiffLoading(false);
        void fetchStatus(repoVersion);
    }, [repoPath, fetchStatus]);

    async function showDiff(filePath: string, fromStaged?: boolean) {
        const repoVersion = repoVersionRef.current;
        const requestId = ++diffRequestIdRef.current;
        setSelectedFile(filePath);
        setDiffContent(null);
        setDiffLoading(true);
        if (fromStaged !== undefined) {
            setDiffTab(fromStaged ? "staged" : "unstaged");
        }
        try {
            const result = await sendRequest<GitDiffFileContentResult>(MSG.GIT_DIFF_FILE_CONTENT, {
                repoPath,
                filePath,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            setDiffContent(result);
            // If the requested tab has no content, switch to the other
            if (fromStaged && !result.staged && result.unstaged) {
                setDiffTab("unstaged");
            } else if (!fromStaged && !result.unstaged && result.staged) {
                setDiffTab("staged");
            }
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== diffRequestIdRef.current) return;
            console.error("Failed to fetch diff:", err);
            setDiffContent(null);
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
                    setDiffContent(null);
                    setDiffLoading(false);
                }
            },
        });
    }

    const hasNoChanges =
        status && status.stagedFiles.length === 0 && status.unstagedFiles.length === 0;

    const activeDiffPair =
        diffContent &&
        (diffTab === "staged" && diffContent.staged
            ? diffContent.staged
            : (diffContent.unstaged ?? diffContent.staged));

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
                                    onSelect={(path) => showDiff(path, true)}
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
                                    onSelect={(path) => showDiff(path, false)}
                                    onRevert={revertFile}
                                    onStageToggle={stageFile}
                                />
                            ))}
                    </>
                )}
            </div>

            {/* Diff view */}
            <div className="flex min-h-0 flex-1 flex-col">
                {diffLoading ? (
                    <div className="text-muted-foreground p-3 text-sm">Loading diff...</div>
                ) : diffContent && (diffContent.staged || diffContent.unstaged) ? (
                    <>
                        {diffContent.staged && diffContent.unstaged && (
                            <div className="border-border flex gap-1 border-b px-3 py-1">
                                <button
                                    onClick={() => setDiffTab("staged")}
                                    className={cn(
                                        "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                                        diffTab === "staged"
                                            ? "bg-accent/20 text-accent"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}>
                                    Staged
                                </button>
                                <button
                                    onClick={() => setDiffTab("unstaged")}
                                    className={cn(
                                        "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                                        diffTab === "unstaged"
                                            ? "bg-accent/20 text-accent"
                                            : "text-muted-foreground hover:text-foreground",
                                    )}>
                                    Unstaged
                                </button>
                            </div>
                        )}
                        <div className="min-h-0 flex-1">
                            <MonacoDiffViewer
                                original={activeDiffPair?.original ?? ""}
                                modified={activeDiffPair?.modified ?? ""}
                                language={selectedFile ? getLanguage(selectedFile) : "plaintext"}
                            />
                        </div>
                    </>
                ) : selectedFile ? (
                    <div className="text-muted-foreground p-3 text-sm">
                        No textual diff available for this file
                    </div>
                ) : (
                    <div className="text-muted-foreground p-3 text-sm">
                        Click a file to see its diff
                    </div>
                )}
            </div>
        </div>
    );
}

export { ChangesPane };
