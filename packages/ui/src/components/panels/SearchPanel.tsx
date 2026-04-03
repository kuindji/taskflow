import { useCallback, useEffect, useRef, useState } from "react";
import {
    X,
    CaseSensitive,
    WholeWord,
    Regex,
    Filter,
    ReplaceAll,
} from "lucide-react";
import { useSearchStore } from "@/stores/search-store";
import { useUIStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { openFileInApp } from "@/lib/open-file";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";
import useIsElectron from "@/hooks/useIsElectron";
import { SearchResults } from "./SearchResults";

function SearchPanel() {
    const workspace = useActiveWorkspace();
    const workingDir = workspace.workingDir;
    const taskId = workspace.task?.id;
    const projectId = workspace.project?.id;
    const workspaceKey = workspace.workspaceKey;
    const isElectron = useIsElectron();
    const toggleSearchPanel = useUIStore((s) => s.toggleSearchPanel);

    const query = useSearchStore((s) => s.query);
    const replacement = useSearchStore((s) => s.replacement);
    const caseSensitive = useSearchStore((s) => s.caseSensitive);
    const wholeWord = useSearchStore((s) => s.wholeWord);
    const useRegex = useSearchStore((s) => s.useRegex);
    const includePattern = useSearchStore((s) => s.includePattern);
    const excludePattern = useSearchStore((s) => s.excludePattern);
    const results = useSearchStore((s) => s.results);
    const totalMatches = useSearchStore((s) => s.totalMatches);
    const searching = useSearchStore((s) => s.searching);
    const error = useSearchStore((s) => s.error);

    const setQuery = useSearchStore((s) => s.setQuery);
    const setReplacement = useSearchStore((s) => s.setReplacement);
    const toggleCaseSensitive = useSearchStore((s) => s.toggleCaseSensitive);
    const toggleWholeWord = useSearchStore((s) => s.toggleWholeWord);
    const toggleUseRegex = useSearchStore((s) => s.toggleUseRegex);
    const setIncludePattern = useSearchStore((s) => s.setIncludePattern);
    const setExcludePattern = useSearchStore((s) => s.setExcludePattern);
    const search = useSearchStore((s) => s.search);
    const replaceAll = useSearchStore((s) => s.replaceAll);
    const clear = useSearchStore((s) => s.clear);

    const [showFilters, setShowFilters] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Auto-search with debounce
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (!workingDir || !query) {
            return;
        }

        if (query.length >= 3) {
            debounceRef.current = setTimeout(() => {
                void search(workingDir);
            }, 300);
        }

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [query, caseSensitive, wholeWord, useRegex, includePattern, excludePattern, workingDir, search]);

    // Focus search input on mount
    useEffect(() => {
        searchInputRef.current?.focus();
    }, []);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && workingDir) {
                e.preventDefault();
                void search(workingDir);
            }
            if (e.key === "Escape") {
                if (results.length > 0 || query) {
                    clear();
                } else {
                    toggleSearchPanel();
                }
            }
        },
        [workingDir, search, results.length, query, clear, toggleSearchPanel],
    );

    const handleReplaceKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                if (results.length > 0 || query) {
                    clear();
                } else {
                    toggleSearchPanel();
                }
            }
        },
        [results.length, query, clear, toggleSearchPanel],
    );

    const handleReplaceAll = useCallback(() => {
        if (!workingDir) return;
        void replaceAll(workingDir);
    }, [workingDir, replaceAll]);

    const handleFileClick = useCallback(
        (path: string, line: number) => {
            const owner = taskId ? { taskId } : projectId ? { projectId } : undefined;
            void openFileInApp(path, workspaceKey, owner, line);
        },
        [taskId, projectId, workspaceKey],
    );

    return (
        <div className="flex h-full flex-col">
            <Toolbar className={`gap-2 ${isElectron ? "[-webkit-app-region:drag]" : ""}`}>
                <span className="text-muted-foreground ml-2 flex h-6 items-center text-xs font-medium">
                    Search
                </span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleSearchPanel}
                    aria-label="Hide search panel"
                    tooltip="Hide search panel"
                    tooltipSide="bottom"
                    className="[-webkit-app-region:no-drag]">
                    <X className="h-3 w-3" />
                </Button>
            </Toolbar>

            <div className="flex flex-col gap-1.5 p-2">
                {/* Search input */}
                <div className="border-border bg-background flex items-center rounded-md border">
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search"
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
                    />
                    <Button
                        variant={caseSensitive ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleCaseSensitive}
                        aria-label="Match case"
                        tooltip="Match case"
                        tooltipSide="bottom">
                        <CaseSensitive className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={wholeWord ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleWholeWord}
                        aria-label="Match whole word"
                        tooltip="Match whole word"
                        tooltipSide="bottom">
                        <WholeWord className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={useRegex ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={toggleUseRegex}
                        aria-label="Use regular expression"
                        tooltip="Use regular expression"
                        tooltipSide="bottom">
                        <Regex className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* Replace input */}
                <div className="border-border bg-background flex items-center rounded-md border">
                    <input
                        type="text"
                        value={replacement}
                        onChange={(e) => setReplacement(e.target.value)}
                        onKeyDown={handleReplaceKeyDown}
                        placeholder="Replace"
                        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs outline-none"
                    />
                    <Button
                        variant="ghost"
                        size="icon-2xs"
                        onClick={handleReplaceAll}
                        disabled={results.length === 0}
                        aria-label="Replace all"
                        tooltip="Replace all"
                        tooltipSide="bottom">
                        <ReplaceAll className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant={showFilters ? "secondary" : "ghost"}
                        size="icon-2xs"
                        onClick={() => setShowFilters(!showFilters)}
                        aria-label="Toggle file filters"
                        tooltip="Toggle file filters"
                        tooltipSide="bottom">
                        <Filter className="h-3.5 w-3.5" />
                    </Button>
                </div>

                {/* File filters */}
                {showFilters && (
                    <div className="flex flex-col gap-1">
                        <input
                            type="text"
                            value={includePattern}
                            onChange={(e) => setIncludePattern(e.target.value)}
                            placeholder="Files to include (e.g. *.ts, src/**)"
                            className="border-border bg-background rounded-md border px-2 py-1 text-xs outline-none"
                        />
                        <input
                            type="text"
                            value={excludePattern}
                            onChange={(e) => setExcludePattern(e.target.value)}
                            placeholder="Files to exclude (e.g. *.test.ts, dist/**)"
                            className="border-border bg-background rounded-md border px-2 py-1 text-xs outline-none"
                        />
                    </div>
                )}

                {/* Status */}
                {searching && (
                    <div className="text-muted-foreground text-xs">Searching...</div>
                )}
                {error && (
                    <div className="text-destructive text-xs">{error}</div>
                )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-x-auto overflow-y-auto">
                {workingDir && (
                    <SearchResults
                        rootPath={workingDir}
                        results={results}
                        totalMatches={totalMatches}
                        onFileClick={handleFileClick}
                    />
                )}
                {!searching && query && results.length === 0 && !error && (
                    <div className="text-muted-foreground px-2 py-1 text-xs">No results found</div>
                )}
            </div>
        </div>
    );
}

export { SearchPanel };
