import { useCallback, useEffect, useRef, useState } from "react";
import type {
    GitCommitFile,
    GitCommitFilesResult,
    GitFileContentPair,
    GitLogEntry,
    GitLogResult,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { cn } from "@/lib/utils";
import { getLanguage } from "@/lib/editor-language";
import { MonacoDiffViewer } from "./MonacoDiffViewer";

const PAGE_SIZE = 100;

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
    { unit: "year", seconds: 31536000 },
    { unit: "month", seconds: 2592000 },
    { unit: "week", seconds: 604800 },
    { unit: "day", seconds: 86400 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
];

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatCommitDate(iso: string): string {
    const elapsed = (new Date(iso).getTime() - Date.now()) / 1000;
    if (Number.isNaN(elapsed)) return "";
    for (const { unit, seconds } of RELATIVE_UNITS) {
        if (Math.abs(elapsed) >= seconds) {
            return relativeFormat.format(Math.round(elapsed / seconds), unit);
        }
    }
    return "just now";
}

function statusPrefix(status: GitCommitFile["status"]): string {
    if (status === "new") return "+";
    if (status === "deleted") return "D";
    if (status === "renamed") return "R";
    return "M";
}

function displayPath(file: GitCommitFile): string {
    return file.status === "renamed" && file.previousPath
        ? `${file.previousPath} -> ${file.path}`
        : file.path;
}

function isBinary(file: GitCommitFile): boolean {
    return file.additions === -1 && file.deletions === -1;
}

interface CommitRowProps {
    entry: GitLogEntry;
    isSelected: boolean;
    onSelect: (hash: string) => void;
}

function CommitRow({ entry, isSelected, onSelect }: CommitRowProps) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onSelect(entry.hash)}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(entry.hash);
                }
            }}
            className={cn(
                "group hover:bg-muted/60 cursor-pointer rounded-md px-1.5 py-1 text-sm transition-colors",
                isSelected && "bg-muted",
            )}>
            <div className="flex items-center justify-between gap-1">
                <span className="text-secondary-foreground min-w-0 flex-1 truncate">
                    {entry.subject}
                </span>
                <span
                    className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}>
                    {/* CopyButton doesn't stop propagation itself; without this
                        a copy click or keypress would also select the commit row */}
                    <CopyButton value={entry.hash} tooltip="Copy hash" />
                </span>
            </div>
            <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                <span className="font-mono">{entry.shortHash}</span>
                <span className="truncate">{entry.authorName}</span>
                <span className="shrink-0">{formatCommitDate(entry.date)}</span>
                {entry.refs.map((ref) => (
                    <Badge key={ref} variant="outline" className="px-1 py-0 text-xs">
                        {ref}
                    </Badge>
                ))}
            </div>
        </div>
    );
}

interface HistoryPaneProps {
    repoPath: string;
    className?: string;
}

function HistoryPane({ repoPath, className }: HistoryPaneProps) {
    const [entries, setEntries] = useState<GitLogEntry[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [logLoading, setLogLoading] = useState(true);
    const [logError, setLogError] = useState(false);
    const [selectedHash, setSelectedHash] = useState<string | null>(null);
    const [files, setFiles] = useState<GitCommitFile[] | null>(null);
    const [filesError, setFilesError] = useState(false);
    const [selectedFile, setSelectedFile] = useState<GitCommitFile | null>(null);
    const [diffPair, setDiffPair] = useState<GitFileContentPair | null>(null);
    const [diffLoading, setDiffLoading] = useState(false);
    const [diffError, setDiffError] = useState(false);
    const repoVersionRef = useRef(0);
    const requestIdRef = useRef(0);

    const fetchLog = useCallback(
        async (skip: number, repoVersion = repoVersionRef.current) => {
            setLogLoading(true);
            try {
                const result = await sendRequest<GitLogResult>(MSG.GIT_LOG, {
                    repoPath,
                    limit: PAGE_SIZE,
                    skip,
                });
                if (repoVersion !== repoVersionRef.current) return;
                setEntries((prev) => (skip === 0 ? result.entries : [...prev, ...result.entries]));
                setHasMore(result.hasMore);
                setLogError(false);
            } catch (err: unknown) {
                if (repoVersion !== repoVersionRef.current) return;
                console.error("Failed to fetch git log:", err);
                setLogError(true);
            } finally {
                if (repoVersion === repoVersionRef.current) setLogLoading(false);
            }
        },
        [repoPath],
    );

    useEffect(() => {
        const repoVersion = ++repoVersionRef.current;
        requestIdRef.current += 1;
        setEntries([]);
        setHasMore(false);
        setLogError(false);
        setSelectedHash(null);
        setFiles(null);
        setFilesError(false);
        setSelectedFile(null);
        setDiffPair(null);
        setDiffLoading(false);
        setDiffError(false);
        void fetchLog(0, repoVersion);
    }, [repoPath, fetchLog]);

    async function selectCommit(hash: string) {
        const repoVersion = repoVersionRef.current;
        const requestId = ++requestIdRef.current;
        setSelectedHash(hash);
        setFiles(null);
        setFilesError(false);
        setSelectedFile(null);
        setDiffPair(null);
        setDiffLoading(false);
        setDiffError(false);
        try {
            const result = await sendRequest<GitCommitFilesResult>(MSG.GIT_COMMIT_FILES, {
                repoPath,
                hash,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            setFiles(result.files);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            console.error("Failed to fetch commit files:", err);
            setFilesError(true);
        }
    }

    async function selectFile(file: GitCommitFile) {
        if (!selectedHash) return;
        const repoVersion = repoVersionRef.current;
        const requestId = ++requestIdRef.current;
        setSelectedFile(file);
        setDiffPair(null);
        setDiffError(false);
        // Clear any in-flight text diff's spinner: its request-id guard means
        // it can no longer clear diffLoading itself
        setDiffLoading(false);
        if (isBinary(file)) return;
        setDiffLoading(true);
        try {
            const result = await sendRequest<GitFileContentPair>(MSG.GIT_COMMIT_DIFF_FILE, {
                repoPath,
                hash: selectedHash,
                path: file.path,
                previousPath: file.status === "renamed" ? file.previousPath : undefined,
            });
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            setDiffPair(result);
        } catch (err: unknown) {
            if (repoVersion !== repoVersionRef.current) return;
            if (requestId !== requestIdRef.current) return;
            console.error("Failed to fetch commit diff:", err);
            setDiffError(true);
        } finally {
            if (repoVersion === repoVersionRef.current && requestId === requestIdRef.current) {
                setDiffLoading(false);
            }
        }
    }

    return (
        <div className={cn("flex min-h-0 min-w-0 flex-1 overflow-hidden", className)}>
            {/* Left column: commits on top, selected commit's files beneath */}
            <div className="border-border flex w-80 shrink-0 flex-col border-r">
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {logError && entries.length === 0 ? (
                        <div className="text-muted-foreground p-1 text-sm">
                            Failed to load history{" "}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 px-1.5 text-xs"
                                onClick={() => void fetchLog(0)}>
                                Retry
                            </Button>
                        </div>
                    ) : entries.length === 0 && !logLoading ? (
                        <div className="text-muted-foreground p-1 text-sm">No commits yet</div>
                    ) : (
                        <>
                            {entries.map((entry) => (
                                <CommitRow
                                    key={entry.hash}
                                    entry={entry}
                                    isSelected={entry.hash === selectedHash}
                                    onSelect={(hash) => void selectCommit(hash)}
                                />
                            ))}
                            {logError ? (
                                <div className="text-muted-foreground p-1 text-sm">
                                    Failed to load more{" "}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 px-1.5 text-xs"
                                        onClick={() => void fetchLog(entries.length)}>
                                        Retry
                                    </Button>
                                </div>
                            ) : hasMore ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="mt-1 h-6 w-full text-xs"
                                    loading={logLoading}
                                    onClick={() => void fetchLog(entries.length)}>
                                    Load more
                                </Button>
                            ) : null}
                        </>
                    )}
                    {logLoading && entries.length === 0 && (
                        <div className="text-muted-foreground p-1 text-sm">Loading history...</div>
                    )}
                </div>
                {selectedHash && (
                    <div className="border-border max-h-[40%] shrink-0 overflow-y-auto border-t p-2">
                        {filesError ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                Failed to load commit{" "}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1.5 text-xs"
                                    onClick={() => void selectCommit(selectedHash)}>
                                    Retry
                                </Button>
                            </div>
                        ) : files === null ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                Loading files...
                            </div>
                        ) : files.length === 0 ? (
                            <div className="text-muted-foreground p-1 text-sm">
                                No files changed
                            </div>
                        ) : (
                            files.map((file) => (
                                <div
                                    key={file.path}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => void selectFile(file)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            void selectFile(file);
                                        }
                                    }}
                                    className={cn(
                                        "hover:bg-muted/60 flex cursor-pointer items-center justify-between gap-1 rounded-md px-1 py-0.5 text-sm transition-colors",
                                        selectedFile?.path === file.path && "bg-muted",
                                    )}>
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "px-1 py-0 font-mono text-xs",
                                                file.status === "deleted" &&
                                                    "text-destructive border-destructive/30",
                                            )}>
                                            {statusPrefix(file.status)}
                                        </Badge>
                                        <TruncatedText
                                            tooltip
                                            className="text-secondary-foreground">
                                            {displayPath(file)}
                                        </TruncatedText>
                                    </span>
                                    <span className="flex shrink-0 gap-0.5 text-xs">
                                        {isBinary(file) ? (
                                            <span className="text-muted-foreground">binary</span>
                                        ) : (
                                            <>
                                                <span className="text-success">
                                                    +{file.additions}
                                                </span>
                                                <span className="text-destructive">
                                                    -{file.deletions}
                                                </span>
                                            </>
                                        )}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Right side: diff area */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {diffLoading ? (
                    <div className="text-muted-foreground p-3 text-sm">Loading diff...</div>
                ) : diffError ? (
                    <div className="text-muted-foreground p-3 text-sm">
                        Failed to load diff{" "}
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-xs"
                            onClick={() => selectedFile && void selectFile(selectedFile)}>
                            Retry
                        </Button>
                    </div>
                ) : selectedFile && isBinary(selectedFile) ? (
                    <div className="text-muted-foreground p-3 text-sm">Binary file</div>
                ) : diffPair ? (
                    <div className="min-h-0 flex-1">
                        <MonacoDiffViewer
                            original={diffPair.original}
                            modified={diffPair.modified}
                            language={selectedFile ? getLanguage(selectedFile.path) : "plaintext"}
                        />
                    </div>
                ) : (
                    <div className="text-muted-foreground p-3 text-sm">
                        {selectedHash
                            ? "Click a file to see its diff"
                            : "Select a commit to see its changes"}
                    </div>
                )}
            </div>
        </div>
    );
}

export { HistoryPane };
