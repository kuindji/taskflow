import { describe, expect, it } from "bun:test";
import { getWorkspaceButtonState } from "./diff-store";
import type { GitStatusResult } from "@taskflow/shared";

function createStatus(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
    return {
        branch: "task/example",
        stagedFiles: [],
        unstagedFiles: [],
        ahead: 0,
        ...overrides,
    };
}

describe("getWorkspaceButtonState", () => {
    it("disables both buttons when there are no file changes and nothing to push", () => {
        expect(getWorkspaceButtonState(createStatus())).toEqual({
            diffDisabled: true,
            commitDisabled: true,
        });
    });

    it("keeps commit enabled for push-only state while diff stays disabled", () => {
        expect(getWorkspaceButtonState(createStatus({ ahead: 2 }))).toEqual({
            diffDisabled: true,
            commitDisabled: false,
        });
    });

    it("enables both buttons when there are file changes", () => {
        expect(
            getWorkspaceButtonState(
                createStatus({
                    unstagedFiles: [
                        {
                            path: "file.ts",
                            status: "modified",
                            staged: false,
                        },
                    ],
                }),
            ),
        ).toEqual({
            diffDisabled: false,
            commitDisabled: false,
        });
    });
});
