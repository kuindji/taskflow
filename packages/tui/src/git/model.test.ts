import { describe, expect, test } from "bun:test";
import type { GitStatusResult } from "@taskflow/shared";
import { changeLabel, gitChanges, stableChangeIndex, stagedCount } from "./model";

const status: GitStatusResult = {
    branch: "feature",
    ahead: 2,
    behind: 1,
    stagedFiles: [
        { path: "renamed.ts", previousPath: "old.ts", status: "renamed", staged: true },
        { path: "partial.ts", status: "modified", staged: true },
    ],
    unstagedFiles: [
        { path: "partial.ts", status: "modified", staged: false },
        { path: "new.ts", status: "untracked", staged: false },
        { path: "gone.ts", status: "deleted", staged: false },
    ],
};

describe("git model", () => {
    test("keeps staged, unstaged, partial, rename, untracked, and deleted rows distinct", () => {
        const changes = gitChanges(status);
        expect(changes.map((change) => change.key)).toEqual([
            "staged:renamed.ts",
            "staged:partial.ts",
            "unstaged:partial.ts",
            "unstaged:new.ts",
            "unstaged:gone.ts",
        ]);
        expect(changeLabel(changes[0])).toBe("renamed  old.ts -> renamed.ts");
        expect(stagedCount(status)).toBe(2);
    });

    test("preserves selection by staged identity", () => {
        const changes = gitChanges(status);
        expect(stableChangeIndex(changes, "unstaged:partial.ts", 0)).toBe(2);
        expect(stableChangeIndex(changes, "missing", 99)).toBe(4);
        expect(stableChangeIndex([], null)).toBe(-1);
    });
});
