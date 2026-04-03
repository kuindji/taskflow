import { useCallback } from "react";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import { useSearchStore } from "@/stores/search-store";
import { ChevronDown, ChevronRight, Replace, ReplaceAll, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileIcon } from "./FileIcon";

interface SearchResultsProps {
    rootPath: string;
    results: SearchFileResult[];
    totalMatches: number;
    onFileClick: (path: string, line: number) => void;
}

function HighlightedLine({ lineContent, column, matchLength }: {
    lineContent: string;
    column: number;
    matchLength: number;
}) {
    const before = lineContent.slice(0, column - 1);
    const match = lineContent.slice(column - 1, column - 1 + matchLength);
    const after = lineContent.slice(column - 1 + matchLength);

    return (
        <span className="whitespace-pre">
            {before}
            <span className="bg-accent/30 text-accent-foreground font-semibold rounded-sm">
                {match}
            </span>
            {after}
        </span>
    );
}

function MatchLine({
    match,
    filePath,
    rootPath,
    onFileClick,
}: {
    match: SearchMatch;
    filePath: string;
    rootPath: string;
    onFileClick: (path: string, line: number) => void;
}) {
    const replaceMatch = useSearchStore((s) => s.replaceMatch);
    const removeMatch = useSearchStore((s) => s.removeMatch);

    const handleReplace = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            void replaceMatch(rootPath, filePath, match);
        },
        [replaceMatch, rootPath, filePath, match],
    );

    const handleDismiss = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            removeMatch(filePath, match);
        },
        [removeMatch, filePath, match],
    );

    return (
        <div
            className="group hover:bg-muted/50 flex cursor-pointer items-center gap-1 py-0.5 pr-1"
            style={{ paddingLeft: 32 }}
            onClick={() => onFileClick(filePath, match.line)}>
            <span className="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums">
                {match.line}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs">
                <HighlightedLine
                    lineContent={match.lineContent}
                    column={match.column}
                    matchLength={match.matchLength}
                />
            </span>
            <Button
                variant="ghost"
                size="icon-2xs"
                onClick={handleReplace}
                aria-label="Replace this match"
                className="shrink-0 opacity-0 group-hover:opacity-100">
                <Replace className="h-3 w-3" />
            </Button>
            <Button
                variant="ghost"
                size="icon-2xs"
                onClick={handleDismiss}
                aria-label="Dismiss this match"
                className="shrink-0 opacity-0 group-hover:opacity-100">
                <X className="h-3 w-3" />
            </Button>
        </div>
    );
}

function FileGroup({
    file,
    rootPath,
    onFileClick,
}: {
    file: SearchFileResult;
    rootPath: string;
    onFileClick: (path: string, line: number) => void;
}) {
    const expanded = useSearchStore((s) => s.expandedFiles.has(file.path));
    const toggleFileExpanded = useSearchStore((s) => s.toggleFileExpanded);
    const replaceInFile = useSearchStore((s) => s.replaceInFile);
    const removeFile = useSearchStore((s) => s.removeFile);

    const relativePath = file.path.startsWith(rootPath + "/")
        ? file.path.slice(rootPath.length + 1)
        : file.path;
    const fileName = relativePath.split("/").pop() ?? relativePath;
    const dirPath = relativePath.includes("/")
        ? relativePath.slice(0, relativePath.lastIndexOf("/"))
        : "";

    const handleToggle = useCallback(() => {
        toggleFileExpanded(file.path);
    }, [toggleFileExpanded, file.path]);

    const handleReplaceInFile = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            void replaceInFile(rootPath, file.path);
        },
        [replaceInFile, rootPath, file.path],
    );

    const handleDismissFile = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            removeFile(file.path);
        },
        [removeFile, file.path],
    );

    return (
        <div>
            <div
                className="group hover:bg-muted/50 flex cursor-pointer items-center gap-1 px-1 py-0.5"
                onClick={handleToggle}>
                {expanded ? (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                )}
                <FileIcon name={fileName} isDirectory={false} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate text-xs font-medium">{fileName}</span>
                {dirPath && (
                    <span className="text-muted-foreground min-w-0 shrink truncate text-xs">
                        {dirPath}
                    </span>
                )}
                <span className="bg-muted text-muted-foreground ml-auto shrink-0 rounded-full px-1.5 text-xs tabular-nums">
                    {file.matches.length}
                </span>
                <Button
                    variant="ghost"
                    size="icon-2xs"
                    onClick={handleReplaceInFile}
                    aria-label="Replace all in file"
                    className="shrink-0 opacity-0 group-hover:opacity-100">
                    <ReplaceAll className="h-3 w-3" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-2xs"
                    onClick={handleDismissFile}
                    aria-label="Dismiss file"
                    className="shrink-0 opacity-0 group-hover:opacity-100">
                    <X className="h-3 w-3" />
                </Button>
            </div>
            {expanded &&
                file.matches.map((match, idx) => (
                    <MatchLine
                        key={`${match.line}:${match.column}:${idx}`}
                        match={match}
                        filePath={file.path}
                        rootPath={rootPath}
                        onFileClick={onFileClick}
                    />
                ))}
        </div>
    );
}

function SearchResults({ rootPath, results, totalMatches, onFileClick }: SearchResultsProps) {
    if (results.length === 0) return null;

    return (
        <div className="flex flex-col">
            <div className="text-muted-foreground px-2 py-1 text-xs">
                {totalMatches} result{totalMatches !== 1 ? "s" : ""} in {results.length} file
                {results.length !== 1 ? "s" : ""}
            </div>
            <div>
                {results.map((file) => (
                    <FileGroup
                        key={file.path}
                        file={file}
                        rootPath={rootPath}
                        onFileClick={onFileClick}
                    />
                ))}
            </div>
        </div>
    );
}

export { SearchResults };
