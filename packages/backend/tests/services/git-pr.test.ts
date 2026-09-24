import { expect, it } from "bun:test";
import type { GitService } from "../../src/services/git-service";
import { generateCommitMessage } from "../../src/services/git-pr";

function fakeGit(files: { diff: string; staged: boolean }[]) {
    return { diff: async () => ({ files }) } as unknown as GitService;
}

it("passes staged-only diffs to the generator when unstaged are excluded", async () => {
    const seen: string[] = [];
    const message = await generateCommitMessage(
        fakeGit([
            { diff: "STAGED", staged: true },
            { diff: "UNSTAGED", staged: false },
        ]),
        "/repo",
        false,
        async (diff) => {
            seen.push(diff);
            return "feat: x";
        },
    );
    expect(message).toBe("feat: x");
    expect(seen).toEqual(["STAGED"]);
});

it("reports no changes without running the generator", async () => {
    let ran = false;
    await expect(
        generateCommitMessage(fakeGit([]), "/repo", true, async () => {
            ran = true;
            return "x";
        }),
    ).rejects.toThrow("No changes to commit");
    expect(ran).toBe(false);
});

it("maps generator failures to the existing error", async () => {
    await expect(
        generateCommitMessage(fakeGit([{ diff: "D", staged: true }]), "/repo", true, async () => {
            throw new Error("codex exited with code 1");
        }),
    ).rejects.toThrow("Failed to generate commit message");
});
