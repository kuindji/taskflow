import { create } from "zustand";
import type { SearchFileResult, SearchMatch, SearchResult } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
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
    search(rootPath: string): Promise<void>;
    cancel(): Promise<void>;
    replaceMatch(rootPath: string, filePath: string, match: SearchMatch): Promise<void>;
    replaceInFile(rootPath: string, filePath: string): Promise<void>;
    replaceAll(rootPath: string, filePath?: string): Promise<void>;
    toggleFileExpanded(path: string): void;
    removeMatch(filePath: string, match: SearchMatch): void;
    removeFile(filePath: string): void;
    clear(): void;
}

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

    async search(rootPath) {
        const state = get();
        if (!state.query) {
            set({ results: [], totalMatches: 0, searchId: null, error: null });
            return;
        }

        if (state.searchId) {
            await get().cancel();
        }

        set({ searching: true, error: null });

        try {
            const response = await sendRequest<SearchQueryResponse>(MSG.SEARCH_QUERY, {
                path: rootPath,
                query: state.query,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
            });

            const expanded = new Set<string>();
            for (const file of response.result.files) {
                expanded.add(file.path);
            }

            set({
                results: response.result.files,
                totalMatches: response.result.totalMatches,
                searchId: response.result.searchId,
                searching: false,
                expandedFiles: expanded,
            });
        } catch (err) {
            set({
                searching: false,
                error: err instanceof Error ? err.message : "Search failed",
            });
        }
    },

    async cancel() {
        const { searchId } = get();
        if (searchId) {
            try {
                await sendRequest(MSG.SEARCH_CANCEL, { searchId });
            } catch {
                // Ignore cancel errors
            }
            set({ searchId: null, searching: false });
        }
    },

    async replaceMatch(rootPath, filePath, match) {
        const state = get();
        try {
            await sendRequest<SearchReplaceResponse>(MSG.SEARCH_REPLACE, {
                path: rootPath,
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

    async replaceInFile(rootPath, filePath) {
        const state = get();
        try {
            await sendRequest<SearchReplaceAllResponse>(MSG.SEARCH_REPLACE_ALL, {
                path: rootPath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
                filePath,
            });

            get().removeFile(filePath);
        } catch (err) {
            set({ error: err instanceof Error ? err.message : "Replace failed" });
        }
    },

    async replaceAll(rootPath, filePath) {
        const state = get();
        try {
            await sendRequest<SearchReplaceAllResponse>(MSG.SEARCH_REPLACE_ALL, {
                path: rootPath,
                query: state.query,
                replacement: state.replacement,
                caseSensitive: state.caseSensitive,
                wholeWord: state.wholeWord,
                useRegex: state.useRegex,
                includePattern: state.includePattern,
                excludePattern: state.excludePattern,
                filePath,
            });

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
            searching: false,
            expandedFiles: new Set<string>(),
            error: null,
        });
    },
}));
