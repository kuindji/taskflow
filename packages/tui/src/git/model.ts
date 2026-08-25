import type { GitFileStatus, GitStatusResult } from "@taskflow/shared";

interface GitChange extends GitFileStatus {
    key: string;
    group: "staged" | "unstaged";
}

function gitChanges(status: GitStatusResult | null): GitChange[] {
    if (!status) return [];
    return [
        ...status.stagedFiles.map((file) => ({
            ...file,
            staged: true,
            group: "staged" as const,
            key: `staged:${file.path}`,
        })),
        ...status.unstagedFiles.map((file) => ({
            ...file,
            staged: false,
            group: "unstaged" as const,
            key: `unstaged:${file.path}`,
        })),
    ];
}

function changeLabel(change: GitChange): string {
    const rename = change.previousPath ? `${change.previousPath} -> ${change.path}` : change.path;
    return `${change.status}  ${rename}`;
}

function stableChangeIndex(
    changes: readonly GitChange[],
    selectedKey: string | null,
    previousIndex = 0,
): number {
    if (changes.length === 0) return -1;
    const retained = selectedKey
        ? changes.findIndex((change) => change.key === selectedKey)
        : -1;
    return retained >= 0
        ? retained
        : Math.min(changes.length - 1, Math.max(0, previousIndex));
}

function stagedCount(status: GitStatusResult | null): number {
    return status?.stagedFiles.length ?? 0;
}

export { changeLabel, gitChanges, stableChangeIndex, stagedCount };
export type { GitChange };
