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
