import { expect, it } from "bun:test";
import type { GitService } from "../../src/services/git-service";
import { generateCommitMessage } from "../../src/services/git-pr";
import { expectRejects } from "../expect-rejects";

function fakeGit(files: { diff: string; staged: boolean; state?: "tooLarge" }[]) {
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
    await expectRejects(
        generateCommitMessage(fakeGit([]), "/repo", true, async () => {
            ran = true;
            return "x";
        }),
        "No changes to commit",
    );
    expect(ran).toBe(false);
});

it("maps generator failures to the existing error", async () => {
    await expectRejects(
        generateCommitMessage(fakeGit([{ diff: "D", staged: true }]), "/repo", true, async () => {
            throw new Error("codex exited with code 1");
        }),
        "Failed to generate commit message",
    );
});

it("oversized diffs prevent commit-message generation", async () => {
    let ran = false;
    const files = [
        { diff: "OK", staged: true },
        { diff: "", staged: false, state: "tooLarge" as const },
    ];
    await expectRejects(
        generateCommitMessage(fakeGit(files), "/repo", true, async () => {
            ran = true;
            return "partial";
        }),
        "Cannot generate commit message: a file diff exceeds 1 MiB",
    );
    expect(ran).toBe(false);
    expect(await generateCommitMessage(fakeGit(files), "/repo", false, async (text) => text)).toBe(
        "OK",
    );
});
