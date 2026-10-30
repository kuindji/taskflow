import type { TaskWorktreePr } from "./task";

export type GitPrProvider = "github" | "gitlab";
export type GitPrState = "open" | "closed" | "merged";
export type GitPrUnavailableReason =
    | "cli-missing"
    | "not-authenticated"
    | "failed"
    | "unsupported-host";
export type GitCheckPrResult =
    | {
          status: "found";
          provider: GitPrProvider;
          pr: TaskWorktreePr & { provider: GitPrProvider; state: GitPrState };
      }
    | { status: "none"; provider: GitPrProvider; pr: null }
    | {
          status: "unavailable";
          provider: GitPrProvider | null;
          pr: null;
          reason: GitPrUnavailableReason;
          message: string;
      };

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
    state?: "tooLarge";
}

export type GitDiffFileResult =
    | { staged?: string; unstaged?: string; state?: never }
    | { state: "tooLarge"; staged?: never; unstaged?: never };

export type GitFileContentPair =
    | { original: string; modified: string; state?: never }
    | { state: "tooLarge"; limit: "diff" | "preview"; original?: never; modified?: never }
    | { state: "binary"; original?: never; modified?: never };

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
