import { create } from "zustand";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";
import type {
    SearchQueryResponse,
    SearchReplaceResponse,
    SearchReplaceAllResponse,
} from "@taskflow/shared";

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

        try {
            const response = await sendRequest<SearchQueryResponse>(backendId, MSG.SEARCH_QUERY, {
                path: rootPath,
                query: state.query,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
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
        const state = get();
        if (!state.searchBackendId || !state.searchRoot) return;
        try {
            await sendRequest<SearchReplaceResponse>(state.searchBackendId, MSG.SEARCH_REPLACE, {
                path: state.searchRoot,
                filePath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                matches: [match],
            });

            get().removeMatch(filePath, match);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceInFile(filePath) {
        const state = get();
        if (!state.searchBackendId || !state.searchRoot) return;
        try {
            await sendRequest<SearchReplaceAllResponse>(
                state.searchBackendId,
                MSG.SEARCH_REPLACE_ALL,
                {
                    path: state.searchRoot,
                    query: state.query,
                    replacement: state.replacement,
                    caseSensitive: state.caseSensitive,
                    wholeWord: state.wholeWord,
                    useRegex: state.useRegex,
                    includePattern: state.includePattern,
                    excludePattern: state.excludePattern,
                    filePath,
                },
            );

            get().removeFile(filePath);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceAll(filePath) {
        const state = get();
        if (!state.searchBackendId || !state.searchRoot) return;
        try {
            await sendRequest<SearchReplaceAllResponse>(
                state.searchBackendId,
                MSG.SEARCH_REPLACE_ALL,
                {
                    path: state.searchRoot,
                    query: state.query,
                    replacement: state.replacement,
                    caseSensitive: state.caseSensitive,
                    wholeWord: state.wholeWord,
                    useRegex: state.useRegex,
                    includePattern: state.includePattern,
                    excludePattern: state.excludePattern,
                    filePath,
                },
            );

            if (filePath) {
                get().removeFile(filePath);
            } else {
                set({ results: [], totalMatches: 0 });
            }
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
        expandedFiles: new Set<string>(),
        error: null,
    });
});
