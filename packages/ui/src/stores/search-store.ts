import { create } from "zustand";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";
import type {
    SearchQueryPayload,
    SearchQueryResponse,
    SearchReplaceResponse,
    SearchReplaceAllPayload,
    SearchReplaceAllResponse,
} from "@taskflow/shared";

type SearchedWith = Omit<SearchQueryPayload, "path">;

interface SearchStore {
    query: string;
    replacement: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    useRegex: boolean;
    includePattern: string;
    excludePattern: string;
    results: SearchFileResult[];
    totalMatches: number;
    searchId: string | null;
    /**
     * The machine and root the shown results came from. Their id and any replace
     * in them are that machine's, whatever workspace is open, or searched, by the
     * time they are used. Set when results land, not when a search starts.
     */
    searchBackendId: string | null;
    searchRoot: string | null;
    /**
     * The query and options the shown results were found with. A replace acts
     * on those results, not on whatever the inputs say by now.
     */
    searchedWith: SearchedWith | null;
    searching: boolean;
    expandedFiles: Set<string>;
    error: string | null;

    setQuery(query: string): void;
    setReplacement(replacement: string): void;
    toggleCaseSensitive(): void;
    toggleWholeWord(): void;
    toggleUseRegex(): void;
    setIncludePattern(pattern: string): void;
    setExcludePattern(pattern: string): void;
    search(backendId: string, rootPath: string): Promise<void>;
    cancel(): Promise<void>;
    replaceMatch(filePath: string, match: SearchMatch): Promise<void>;
    replaceInFile(filePath: string): Promise<void>;
    replaceAll(filePath?: string): Promise<void>;
    toggleFileExpanded(path: string): void;
    removeMatch(filePath: string, match: SearchMatch): void;
    removeFile(filePath: string): void;
    clear(): void;
}

/**
 * The line now reads differently: later matches on it moved by the length
 * difference, and every match on it carries the new text so the backend accepts
 * their coordinates.
 */
function shiftAfterReplace(
    matches: SearchMatch[],
    replaced: SearchMatch,
    replacement: string,
): SearchMatch[] {
    const start = replaced.column - 1;
    const lineContent =
        replaced.lineContent.slice(0, start) +
        replacement +
        replaced.lineContent.slice(start + replaced.matchLength);
    const delta = replacement.length - replaced.matchLength;
    return matches.map((m) => {
        if (m.line !== replaced.line || m.column === replaced.column) return m;
        return {
            ...m,
            column: m.column > replaced.column ? m.column + delta : m.column,
            lineContent,
        };
    });
}

const SKIPPED_REASON = "changed since the search or is not UTF-8 text. Search again.";

/**
 * After a bulk replace of the shown results (one file's, or all of them):
 * the backend skips a file that changed or is not UTF-8 text, so fewer
 * replacements than shown means some are still on disk. With none replaced
 * the results stay; otherwise which ones remain is unknown and they go.
 */
function settleBulkReplace(replacedCount: number, filePath?: string): void {
    const { results, removeFile } = useSearchStore.getState();
    const scope = filePath ? results.filter((f) => f.path === filePath) : results;
    const shown = scope.reduce((sum, f) => sum + f.matches.length, 0);
    if (replacedCount === 0 && shown > 0) {
        useSearchStore.setState({ error: `Not replaced: the text ${SKIPPED_REASON}` });
        return;
    }
    if (filePath) {
        removeFile(filePath);
    } else {
        useSearchStore.setState({ results: [], totalMatches: 0 });
    }
    if (replacedCount < shown) {
        useSearchStore.setState({
            error: `Replaced ${replacedCount} of ${shown} matches: the rest ${SKIPPED_REASON}`,
        });
    }
}

/** Bumped by every search and by a detach of the searched machine: a late answer is dropped. */
let searchGeneration = 0;
/** The machine the running search asked, until its answer lands. */
let pendingSearchBackendId: string | null = null;

export const useSearchStore = create<SearchStore>((set, get) => ({
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    includePattern: "",
    excludePattern: "",
    results: [],
    totalMatches: 0,
    searchId: null,
    searchBackendId: null,
    searchRoot: null,
    searchedWith: null,
    searching: false,
    expandedFiles: new Set<string>(),
    error: null,

    setQuery(query) {
        set({ query });
    },
    setReplacement(replacement) {
        set({ replacement });
    },
    toggleCaseSensitive() {
        set((s) => ({ caseSensitive: !s.caseSensitive }));
    },
    toggleWholeWord() {
        set((s) => ({ wholeWord: !s.wholeWord }));
    },
    toggleUseRegex() {
        set((s) => ({ useRegex: !s.useRegex }));
    },
    setIncludePattern(pattern) {
        set({ includePattern: pattern });
    },
    setExcludePattern(pattern) {
        set({ excludePattern: pattern });
    },

    async search(backendId, rootPath) {
        const state = get();
        if (!state.query) {
            set({
                results: [],
                totalMatches: 0,
                searchId: null,
                searchBackendId: null,
                searchRoot: null,
                searchedWith: null,
                error: null,
            });
            return;
        }

        if (state.searchId) {
            await get().cancel();
        }

        const generation = ++searchGeneration;
        pendingSearchBackendId = backendId;
        set({ searching: true, error: null });
        const searchedWith: SearchedWith = {
            query: state.query,
            caseSensitive: state.caseSensitive,
            wholeWord: state.wholeWord,
            useRegex: state.useRegex,
            includePattern: state.includePattern,
            excludePattern: state.excludePattern,
        };

        try {
            const response = await sendRequest<SearchQueryResponse>(backendId, MSG.SEARCH_QUERY, {
                path: rootPath,
                ...searchedWith,
            });

            if (generation !== searchGeneration) return;
            pendingSearchBackendId = null;
            const expanded = new Set<string>();
            for (const file of response.result.files) {
                expanded.add(file.path);
            }

            set({
                results: response.result.files,
                totalMatches: response.result.totalMatches,
                searchId: response.result.searchId,
                searchBackendId: backendId,
                searchRoot: rootPath,
                searchedWith,
                searching: false,
                expandedFiles: expanded,
            });
        } catch (err) {
            if (generation !== searchGeneration) return;
            pendingSearchBackendId = null;
            set({
                searching: false,
                error: err instanceof Error ? err.message : "Search failed",
            });
        }
    },

    async cancel() {
        const { searchId, searchBackendId } = get();
        if (searchId) {
            try {
                // Only the machine that issued the id knows it: never the open workspace's.
                if (searchBackendId) {
                    await sendRequest(searchBackendId, MSG.SEARCH_CANCEL, { searchId });
                }
            } catch {
                // Ignore cancel errors
            }
            set({ searchId: null, searching: false });
        }
    },

    async replaceMatch(filePath, match) {
        const { searchBackendId, searchRoot, searchedWith, replacement } = get();
        if (!searchBackendId || !searchRoot || !searchedWith) return;
        try {
            const { replacedCount } = await sendRequest<SearchReplaceResponse>(
                searchBackendId,
                MSG.SEARCH_REPLACE,
                {
                    path: searchRoot,
                    filePath,
                    query: searchedWith.query,
                    replacement,
                    caseSensitive: searchedWith.caseSensitive,
                    wholeWord: searchedWith.wholeWord,
                    useRegex: searchedWith.useRegex,
                    matches: [match],
                },
            );

            if (replacedCount === 0) {
                set({
                    error: `Not replaced: the file ${SKIPPED_REASON}`,
                });
                return;
            }
            // Removed before the shift: a match right after an emptied one
            // moves onto its coordinates.
            get().removeMatch(filePath, match);
            set((s) => {
                const results = s.results.map((file) =>
                    file.path === filePath
                        ? { ...file, matches: shiftAfterReplace(file.matches, match, replacement) }
                        : file,
                );
                return { results };
            });
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceInFile(filePath) {
        const { searchBackendId, searchRoot, searchedWith, replacement, results } = get();
        if (!searchBackendId || !searchRoot || !searchedWith) return;
        try {
            const { replacedCount } = await sendRequest<SearchReplaceAllResponse>(
                searchBackendId,
                MSG.SEARCH_REPLACE_ALL,
                {
                    path: searchRoot,
                    ...searchedWith,
                    replacement,
                    filePath,
                    shown: results,
                } satisfies SearchReplaceAllPayload,
            );

            settleBulkReplace(replacedCount, filePath);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceAll(filePath) {
        const { searchBackendId, searchRoot, searchedWith, replacement, results } = get();
        if (!searchBackendId || !searchRoot || !searchedWith) return;
        try {
            // Only what is still listed: a dismissed file or match stays as it is.
            const { replacedCount } = await sendRequest<SearchReplaceAllResponse>(
                searchBackendId,
                MSG.SEARCH_REPLACE_ALL,
                {
                    path: searchRoot,
                    ...searchedWith,
                    replacement,
                    filePath,
                    shown: results,
                } satisfies SearchReplaceAllPayload,
            );

            settleBulkReplace(replacedCount, filePath);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace all failed" });
        }
    },

    toggleFileExpanded(path) {
        set((s) => {
            const next = new Set(s.expandedFiles);
            if (next.has(path)) {
                next.delete(path);
            } else {
                next.add(path);
            }
            return { expandedFiles: next };
        });
    },

    removeMatch(filePath, match) {
        set((s) => {
            const results = s.results
                .map((file) => {
                    if (file.path !== filePath) return file;
                    const filtered = file.matches.filter(
                        (m) => m.line !== match.line || m.column !== match.column,
                    );
                    if (filtered.length === 0) return null;
                    return { ...file, matches: filtered };
                })
                .filter((f): f is SearchFileResult => f !== null);

            const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
            return { results, totalMatches };
        });
    },

    removeFile(filePath) {
        set((s) => {
            const results = s.results.filter((f) => f.path !== filePath);
            const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
            return { results, totalMatches };
        });
    },

    clear() {
        set({
            query: "",
            replacement: "",
            results: [],
            totalMatches: 0,
            searchId: null,
            searchBackendId: null,
            searchRoot: null,
            searchedWith: null,
            searching: false,
            expandedFiles: new Set<string>(),
            error: null,
        });
    },
}));

registerBackendReset("search-store", (backendId) => {
    if (pendingSearchBackendId === backendId) {
        // Its answer would be a dropped machine's; whatever results are shown stay.
        searchGeneration++;
        pendingSearchBackendId = null;
        useSearchStore.setState({ searching: false });
    }
    if (useSearchStore.getState().searchBackendId !== backendId) return;
    // The query and options are the user's and stay; the results were that machine's.
    useSearchStore.setState({
        results: [],
        totalMatches: 0,
        searchId: null,
        searchBackendId: null,
        searchRoot: null,
        searchedWith: null,
        expandedFiles: new Set<string>(),
        error: null,
    });
});
