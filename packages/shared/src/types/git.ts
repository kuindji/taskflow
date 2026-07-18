export interface GitFileStatus {
    path: string;
    absolutePath?: string;
    previousPath?: string;
    status: "new" | "modified" | "deleted" | "untracked" | "renamed";
    staged: boolean;
}

export interface GitStatusResult {
    branch: string | null;
    stagedFiles: GitFileStatus[];
    unstagedFiles: GitFileStatus[];
    ahead: number;
    behind: number;
}

export interface GitDiffResult {
    files: GitDiffFile[];
}

export interface GitDiffFile {
    path: string;
    additions: number;
    deletions: number;
    diff: string;
    staged: boolean;
}

export interface GitFileContentPair {
    original: string;
    modified: string;
}

export interface GitDiffFileContentResult {
    staged: GitFileContentPair | null;
    unstaged: GitFileContentPair | null;
}

export interface ChangeStats {
    additions: number;
    deletions: number;
    fileCount: number;
    branch: string | null;
    ahead: number;
    behind: number;
    hasChanges: boolean;
    diffDisabled: boolean;
    commitDisabled: boolean;
}

export interface GitLogEntry {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    /** ISO 8601 author date */
    date: string;
    /** Ref decorations (branch/tag names); empty when none */
    refs: string[];
}

export interface GitLogResult {
    entries: GitLogEntry[];
    hasMore: boolean;
}

export interface GitCommitFile {
    path: string;
    previousPath?: string;
    status: "new" | "modified" | "deleted" | "renamed";
    /** -1 when the file is binary */
    additions: number;
    /** -1 when the file is binary */
    deletions: number;
}

export interface GitCommitFilesResult {
    files: GitCommitFile[];
}
