import { describe, expect, test } from "bun:test";
import { changeTargetId } from "./diff-store";

const worktree = { enabled: true, path: "/worktree", branch: "task", pr: null };

describe("changeTargetId", () => {
    test("a worktree task reports under its own id, other tasks under the project's", () => {
        expect(changeTargetId({ id: "t1", worktree }, { id: "p1" })).toBe("t1");
        expect(
            changeTargetId({ id: "t1", worktree: { ...worktree, enabled: false } }, { id: "p1" }),
        ).toBe("p1");
    });

    test("a subtask reports under its parent, which tracks their shared worktree", () => {
        expect(changeTargetId({ id: "child", parentId: "t1", worktree }, { id: "p1" })).toBe("t1");
    });
});
