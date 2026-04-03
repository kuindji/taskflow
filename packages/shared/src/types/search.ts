export interface SearchMatch {
    line: number;
    column: number;
    matchLength: number;
    lineContent: string;
}

export interface SearchFileResult {
    path: string;
    matches: SearchMatch[];
}

export interface SearchResult {
    files: SearchFileResult[];
    totalMatches: number;
    searchId: string;
}
