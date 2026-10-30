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

// These fake-backed cases cannot reach a real repository or account.
import { createPr, checkBranchPr, type GitPrDeps } from "../../src/services/git-pr";
const repo = "/taskflow-gitlab-test-no-such-directory";
const mr = (iid = 7, state = "opened") => ({
    id: 900,
    iid,
    web_url: `https://gitlab.com/group/sub/repo/-/merge_requests/${iid}`,
    state,
});
const pr = (number = 8, state = "OPEN") => ({
    number,
    url: `https://github.com/owner/repo/pull/${number}`,
    state,
});
function prFake(remote = "git@gitlab.com:group/sub/repo.git") {
    const calls: Parameters<GitPrDeps["run"]>[0][] = [];
    const fake = {
        remote,
        currentBranch: "topic",
        installed: ["gh", "glab"],
        authenticated: ["gh", "glab"],
        output: JSON.stringify([mr()]),
        exitCode: 0,
        throws: false,
        deps: {} as GitPrDeps,
        calls,
    };
    fake.deps = {
        remoteUrl: async () => fake.remote,
        branch: async () => fake.currentBranch || null,
        which: (command) => (fake.installed.includes(command) ? command : null),
        run: async (input) => {
            calls.push(input);
            if (fake.throws) throw new Error("spawn failed");
            if (input.args[0] === "auth")
                return {
                    stdout: "secret auth diagnostics",
                    stderr: "secret",
                    exitCode: fake.authenticated.includes(input.command) ? 0 : 1,
                };
            if (input.args[0] === "api" && !input.args.includes("POST"))
                return { stdout: '{"default_branch":"main"}', stderr: "", exitCode: 0 };
            return { stdout: fake.output, stderr: "command failed", exitCode: fake.exitCode };
        },
    };
    return fake;
}

it("github.com selects gh even when glab is authenticated", async () => {
    const f = prFake("https://user:password@github.com/owner/repo.git");
    f.output = JSON.stringify([pr()]);
    expect(await checkBranchPr(repo, "topic", f.deps)).toEqual({
        status: "found",
        provider: "github",
        pr: { ...pr(), state: "open", provider: "github" },
    });
    expect(f.calls.every((c) => c.command === "gh")).toBe(true);
    expect(f.calls.at(-1)?.args).toEqual([
        "pr",
        "list",
        "--repo",
        "github.com/owner/repo",
        "--head",
        "topic",
        "--state",
        "all",
        "--json",
        "number,url,state",
        "--limit",
        "100",
    ]);
    expect(JSON.stringify(f.calls)).not.toContain("password");
    expect(f.calls.at(-1)?.env).toMatchObject({
        GH_HOST: "github.com",
        GIT_TERMINAL_PROMPT: "0",
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
    });
});
it("gitlab.com selects glab even when gh is authenticated", async () => {
    const f = prFake();
    expect((await checkBranchPr(repo, "topic", f.deps)).provider).toBe("gitlab");
    expect(f.calls.every((c) => c.command === "glab")).toBe(true);
    expect(f.calls.at(-1)?.args).toEqual([
        "mr",
        "list",
        "--repo",
        "https://gitlab.com/group/sub/repo",
        "--source-branch",
        "topic",
        "--all",
        "--per-page",
        "100",
        "--output",
        "json",
    ]);
    expect(f.calls.at(-1)?.env?.GITLAB_HOST).toBe("gitlab.com");
});
it("SSH and HTTPS subgroup remotes resolve the same project", async () => {
    for (const remote of [
        "git@GITLAB.com:group/sub/repo.git",
        "ssh://git@gitlab.com/group/sub/repo.git",
        "https://user:secret@gitlab.com/group/sub/repo",
    ]) {
        const f = prFake(remote);
        await checkBranchPr(repo, "topic", f.deps);
        expect(f.calls.at(-1)?.args).toContain("https://gitlab.com/group/sub/repo");
    }
});
for (const [provider, cli] of [
    ["GitHub", "gh"],
    ["GitLab", "glab"],
] as const) {
    it(`self-hosted ${provider} uses host-specific authentication`, async () => {
        const f = prFake("git@code.example:group/repo.git");
        f.authenticated = [cli];
        f.output = "[]";
        expect(await checkBranchPr(repo, "topic", f.deps)).toEqual({
            status: "none",
            provider: cli === "gh" ? "github" : "gitlab",
            pr: null,
        });
        expect(f.calls.filter((c) => c.args[0] === "auth").map((c) => c.args)).toEqual([
            ["auth", "status", "--hostname", "code.example"],
            ["auth", "status", "--hostname", "code.example"],
        ]);
    });
}
it("a dual-authenticated self-hosted host is ambiguous", async () => {
    const f = prFake("https://code.example/group/repo");
    expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
        status: "unavailable",
        provider: null,
        message:
            "Remote host is authenticated in both gh and glab; provider selection is ambiguous",
    });
    expect(f.calls).toHaveLength(2);
});
it("missing CLI and missing authentication are unavailable", async () => {
    for (const [host, cli, label] of [
        ["github.com", "gh", "GitHub"],
        ["gitlab.com", "glab", "GitLab"],
    ]) {
        const f = prFake(`https://${host}/owner/repo`);
        f.installed = [];
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            status: "unavailable",
            reason: "cli-missing",
            message: `${label} CLI is not installed`,
        });
        f.installed = [cli];
        f.authenticated = [];
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            status: "unavailable",
            reason: "not-authenticated",
            message: `${label} CLI is not authenticated for ${host}. Run ${cli} auth login --hostname ${host}`,
        });
    }
});
it("unsupported or unrecognized remotes do not guess a provider", async () => {
    for (const remote of [
        "/local/repo",
        "file:///repo",
        "",
        "https://unknown.example/group/repo",
    ]) {
        const f = prFake(remote);
        f.authenticated = [];
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            status: "unavailable",
            provider: null,
            reason: "unsupported-host",
        });
    }
});
it("a successful empty list is none", async () => {
    const f = prFake();
    f.output = "[]";
    expect(await checkBranchPr(repo, "topic", f.deps)).toEqual({
        status: "none",
        provider: "gitlab",
        pr: null,
    });
});
it("a failed or malformed list is unavailable", async () => {
    for (const output of [
        "not json",
        "{}",
        "[{}]",
        JSON.stringify([mr(), { ...mr(), iid: 0 }]),
        JSON.stringify([{ ...mr(), web_url: "file:///secret" }]),
        JSON.stringify([{ ...mr(), state: "unknown" }]),
    ]) {
        const f = prFake();
        f.output = output;
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            status: "unavailable",
            reason: "failed",
            message: "Merge request status is unavailable",
        });
    }
    const f = prFake();
    f.exitCode = 1;
    expect((await checkBranchPr(repo, "topic", f.deps)).status).toBe("unavailable");
    f.throws = true;
    expect((await checkBranchPr(repo, "topic", f.deps)).status).toBe("unavailable");
});
it("GitLab uses iid instead of id", async () => {
    const f = prFake();
    expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({ pr: { number: 7 } });
});
it("opened closed and merged states normalize correctly", async () => {
    for (const [state, expected] of [
        ["opened", "open"],
        ["open", "open"],
        ["closed", "closed"],
        ["merged", "merged"],
    ]) {
        const f = prFake();
        f.output = JSON.stringify([mr(7, state)]);
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            pr: { state: expected },
        });
    }
    for (const state of ["OPEN", "CLOSED", "MERGED"]) {
        const f = prFake("https://github.com/owner/repo");
        f.output = JSON.stringify([pr(8, state)]);
        expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({
            pr: { state: state.toLowerCase() },
        });
    }
});
it("open requests precede older closed or merged requests", async () => {
    const f = prFake();
    f.output = JSON.stringify([mr(99, "closed"), mr(3), mr(10, "merged")]);
    expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({ pr: { number: 3 } });
    f.output = JSON.stringify([mr(2, "closed"), mr(10, "merged")]);
    expect(await checkBranchPr(repo, "topic", f.deps)).toMatchObject({ pr: { number: 10 } });
});
it("GitLab create sends the exact title and multiline description as argv fields", async () => {
    const f = prFake();
    f.currentBranch = "-topic";
    f.output = JSON.stringify(mr());
    const title = '-title "$HOME"';
    const body = "-body\nquotes \" ' $HOME `whoami`";
    expect(await createPr(repo, title, body, f.deps)).toMatchObject({
        number: 7,
        provider: "gitlab",
        state: "open",
    });
    expect(f.calls.at(-2)?.args).toEqual([
        "api",
        "--hostname",
        "gitlab.com",
        "projects/group%2Fsub%2Frepo",
    ]);
    expect(f.calls.at(-1)?.args).toEqual([
        "api",
        "--hostname",
        "gitlab.com",
        "--method",
        "POST",
        "projects/group%2Fsub%2Frepo/merge_requests",
        "--raw-field",
        "source_branch=-topic",
        "--raw-field",
        "target_branch=main",
        "--raw-field",
        `title=${title}`,
        "--raw-field",
        `description=${body}`,
    ]);
});
it("GitHub create sends the exact body on stdin", async () => {
    const f = prFake("https://github.com/owner/repo");
    f.output = pr().url;
    for (const body of ["", '-body\n" $HOME']) {
        expect(await createPr(repo, "title", body, f.deps)).toMatchObject({
            number: 8,
            provider: "github",
            state: "open",
        });
        expect(f.calls.at(-1)).toMatchObject({
            args: [
                "pr",
                "create",
                "--repo",
                "github.com/owner/repo",
                "--head",
                "topic",
                "--title",
                "title",
                "--body-file",
                "-",
            ],
            stdin: body,
        });
    }
});
it("invalid creation output never returns request number zero", async () => {
    const f = prFake("https://github.com/owner/repo");
    f.output = "https://github.com/owner/repo/pull/0";
    await expectRejects(
        createPr(repo, "title", "", f.deps),
        "Request created, but its details could not be read",
    );
});
it("a create parse failure warns against retrying", async () => {
    const f = prFake();
    f.output = "{}";
    await expectRejects(
        createPr(repo, "title", "", f.deps),
        "Request created, but its details could not be read. Refresh request status before retrying.",
    );
    expect(f.calls.filter((c) => c.args.includes("POST"))).toHaveLength(1);
});
it("detached HEAD cannot create a request", async () => {
    const f = prFake();
    f.currentBranch = "";
    await expectRejects(
        createPr(repo, "title", "", f.deps),
        "Cannot create a request from a detached HEAD",
    );
    expect(f.calls).toHaveLength(0);
});
