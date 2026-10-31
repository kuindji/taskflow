import { git } from "./git-helpers";
import { GitService } from "./git-service";
import { buildShellPath } from "./shell-path";
import type {
    GitCheckPrResult,
    GitCreatePrResult,
    GitPrProvider,
    GitPrState,
} from "@taskflow/shared";

async function commit(
    repoPath: string,
    message: string,
    push: boolean,
    includeUnstaged = true,
): Promise<{ hash: string; message: string }> {
    if (includeUnstaged) {
        await git(["add", "-A"], repoPath);
    }
    await git(["commit", "-m", message], repoPath);
    const hashOutput = await git(["rev-parse", "--short", "HEAD"], repoPath, { readOnly: true });
    if (push) {
        await pushBranch(repoPath);
    }
    return { hash: hashOutput.trim(), message };
}

/**
 * Push the current branch. A branch with no upstream (every new task
 * worktree branch) is published to origin and starts tracking it; a plain
 * `git push` refuses such a branch under Git's default `push.default`.
 */
async function pushBranch(repoPath: string): Promise<void> {
    const hasUpstream = await git(
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        repoPath,
        { readOnly: true },
    ).then(
        () => true,
        () => false,
    );
    await git(hasUpstream ? ["push"] : ["push", "--set-upstream", "origin", "HEAD"], repoPath);
}

export interface GitPrDeps {
    remoteUrl(repoPath: string): Promise<string | null>;
    branch(repoPath: string): Promise<string | null>;
    which(command: "gh" | "glab"): string | null;
    run(input: {
        command: string;
        args: string[];
        cwd: string;
        env?: Record<string, string>;
        stdin?: string;
    }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

const defaultPrDeps: GitPrDeps = {
    remoteUrl: (path) => new GitService().getRemoteUrl(path),
    branch: (path) => new GitService().getBranch(path),
    which: (command) => Bun.which(command, { PATH: buildShellPath() }),
    run: async ({ command, args, cwd, env, stdin }) => {
        const proc = Bun.spawn([command, ...args], {
            cwd,
            env: { ...process.env, PATH: buildShellPath(), ...env },
            stdin: new Blob([stdin ?? ""]),
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        return { stdout, stderr, exitCode };
    },
};

function parseRemote(remote: string | null): { host: string; project: string; url: string } | null {
    if (!remote) return null;
    try {
        let host: string;
        let project: string;
        if (/^(https?|ssh):\/\//i.test(remote)) {
            const parsed = new URL(remote);
            // An HTTP(S) port is the instance's; an SSH port is only transport.
            host = (parsed.protocol === "ssh:" ? parsed.hostname : parsed.host).toLowerCase();
            project = parsed.pathname.slice(1);
        } else {
            const match = remote.match(/^(?:[^/@:\s]+@)?([^/:\s]+):(.+)$/);
            if (!match || /^[a-z]$/i.test(match[1])) return null;
            host = match[1].toLowerCase();
            project = match[2];
        }
        project = project.replace(/\/$/, "").replace(/\.git$/, "");
        if (
            !host ||
            !project.includes("/") ||
            project.split("/").some((part) => !part || part === "." || part === "..")
        )
            return null;
        return { host, project, url: `https://${host}/${project}` };
    } catch {
        return null;
    }
}

type Unavailable = Extract<GitCheckPrResult, { status: "unavailable" }>;
function unavailable(
    provider: GitPrProvider | null,
    reason: Unavailable["reason"],
    message: string,
): Unavailable {
    return { status: "unavailable", provider, pr: null, reason, message };
}
function failed(provider: GitPrProvider | null): Unavailable {
    return unavailable(
        provider,
        "failed",
        provider === "gitlab"
            ? "Merge request status is unavailable"
            : "Pull request status is unavailable",
    );
}
function commandEnv(host: string): Record<string, string> {
    return {
        GIT_TERMINAL_PROMPT: "0",
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
        GH_HOST: host,
        GITLAB_HOST: host,
    };
}
async function selectProvider(
    repoPath: string,
    deps: GitPrDeps,
): Promise<
    | Unavailable
    | { host: string; project: string; url: string; provider: GitPrProvider; command: string }
> {
    const remote = parseRemote(await deps.remoteUrl(repoPath));
    const unsupported = () =>
        unavailable(
            null,
            "unsupported-host",
            `No supported pull request provider for remote host ${remote?.host ?? "unknown"}`,
        );
    if (!remote) return unsupported();
    const authenticate = async (command: string) =>
        deps.run({
            command,
            args: ["auth", "status", "--hostname", remote.host],
            cwd: repoPath,
            env: commandEnv(remote.host),
        });
    const known =
        remote.host === "github.com" ? "github" : remote.host === "gitlab.com" ? "gitlab" : null;
    if (known) {
        const cli = known === "github" ? "gh" : "glab";
        const label = known === "github" ? "GitHub" : "GitLab";
        const command = deps.which(cli);
        if (!command) return unavailable(known, "cli-missing", `${label} CLI is not installed`);
        try {
            if ((await authenticate(command)).exitCode !== 0)
                return unavailable(
                    known,
                    "not-authenticated",
                    `${label} CLI is not authenticated for ${remote.host}. Run ${cli} auth login --hostname ${remote.host}`,
                );
        } catch {
            return failed(known);
        }
        return { ...remote, provider: known, command };
    }
    const authenticated: { provider: GitPrProvider; command: string }[] = [];
    for (const [provider, cli] of [
        ["github", "gh"],
        ["gitlab", "glab"],
    ] as const) {
        const command = deps.which(cli);
        if (!command) continue;
        try {
            if ((await authenticate(command)).exitCode === 0)
                authenticated.push({ provider, command });
        } catch {
            return failed(null);
        }
    }
    if (authenticated.length === 2)
        return unavailable(
            null,
            "unsupported-host",
            "Remote host is authenticated in both gh and glab; provider selection is ambiguous",
        );
    if (!authenticated.length) return unsupported();
    return { ...remote, ...authenticated[0] };
}

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/source-control-gitlab/src/server/gitLabMergeRequests.ts
function normalizeRequest(raw: unknown, provider: GitPrProvider): GitCreatePrResult {
    if (typeof raw !== "object" || raw === null) throw new Error("Invalid request record");
    const record = raw as Record<string, unknown>;
    const number = provider === "gitlab" ? record.iid : record.number;
    const url = provider === "gitlab" ? record.web_url : record.url;
    const states: Record<string, GitPrState> =
        provider === "gitlab"
            ? { opened: "open", open: "open", closed: "closed", merged: "merged" }
            : { OPEN: "open", CLOSED: "closed", MERGED: "merged" };
    const state = typeof record.state === "string" ? states[record.state] : undefined;
    if (
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        number <= 0 ||
        typeof url !== "string" ||
        !state
    )
        throw new Error("Invalid request record");
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
        throw new Error("Invalid request URL");
    return { number, url, provider, state };
}

const unreadableCreation =
    "Request created, but its details could not be read. Refresh request status before retrying.";
async function createPr(
    repoPath: string,
    title: string,
    body?: string,
    deps = defaultPrDeps,
): Promise<GitCreatePrResult> {
    const branch = await deps.branch(repoPath);
    if (!branch) throw new Error("Cannot create a request from a detached HEAD");
    const selection = await selectProvider(repoPath, deps);
    if ("status" in selection) throw new Error(selection.message);
    const { provider, command, host, project } = selection;
    const run = async (args: string[], stdin?: string) => {
        const result = await deps.run({
            command,
            args,
            cwd: repoPath,
            env: commandEnv(host),
            stdin,
        });
        if (result.exitCode !== 0)
            throw new Error(
                result.stderr.trim() || `Request creation failed with exit code ${result.exitCode}`,
            );
        return result.stdout.trim();
    };
    let output: string;
    if (provider === "github") {
        output = await run(
            [
                "pr",
                "create",
                "--repo",
                `${host}/${project}`,
                "--head",
                branch,
                "--title",
                title,
                "--body-file",
                "-",
            ],
            body ?? "",
        );
        try {
            const url = output.match(/https?:\/\/[^\s]+\/pull\/[1-9]\d*(?=\s|$)/)?.[0];
            if (!url) throw new Error("Missing request URL");
            return normalizeRequest(
                { number: Number(new URL(url).pathname.split("/").at(-1)), url, state: "OPEN" },
                provider,
            );
        } catch {
            throw new Error(unreadableCreation);
        }
    }
    // Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/source-control-gitlab/src/server/GitLabCli.ts
    const endpoint = `projects/${encodeURIComponent(project)}`;
    const projectInfo: unknown = JSON.parse(await run(["api", "--hostname", host, endpoint]));
    if (
        typeof projectInfo !== "object" ||
        projectInfo === null ||
        !("default_branch" in projectInfo) ||
        typeof projectInfo.default_branch !== "string" ||
        !projectInfo.default_branch.trim()
    )
        throw new Error("GitLab project default branch is unavailable");
    output = await run([
        "api",
        "--hostname",
        host,
        "--method",
        "POST",
        `${endpoint}/merge_requests`,
        "--raw-field",
        `source_branch=${branch}`,
        "--raw-field",
        `target_branch=${projectInfo.default_branch}`,
        "--raw-field",
        `title=${title}`,
        "--raw-field",
        `description=${body ?? ""}`,
    ]);
    try {
        return normalizeRequest(JSON.parse(output), provider);
    } catch {
        throw new Error(unreadableCreation);
    }
}

async function checkBranchPr(
    repoPath: string,
    branch: string,
    deps = defaultPrDeps,
): Promise<GitCheckPrResult> {
    let provider: GitPrProvider | null = null;
    try {
        const selection = await selectProvider(repoPath, deps);
        if ("status" in selection) return selection;
        provider = selection.provider;
        const { host, project, command, url } = selection;
        // Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/source-control-gitlab/src/server/GitLabCli.ts
        const args =
            provider === "github"
                ? [
                      "pr",
                      "list",
                      "--repo",
                      `${host}/${project}`,
                      "--head",
                      branch,
                      "--state",
                      "all",
                      "--json",
                      "number,url,state",
                      "--limit",
                      "100",
                  ]
                : [
                      "mr",
                      "list",
                      "--repo",
                      url,
                      "--source-branch",
                      branch,
                      "--all",
                      "--per-page",
                      "100",
                      "--output",
                      "json",
                  ];
        const result = await deps.run({ command, args, cwd: repoPath, env: commandEnv(host) });
        if (result.exitCode !== 0) return failed(provider);
        const raw: unknown = JSON.parse(result.stdout);
        if (!Array.isArray(raw)) return failed(provider);
        const requests = raw.map((record) => normalizeRequest(record, selection.provider));
        requests.sort(
            (a, b) =>
                Number(b.state === "open") - Number(a.state === "open") || b.number - a.number,
        );
        return requests.length
            ? { status: "found", provider, pr: requests[0] }
            : { status: "none", provider, pr: null };
    } catch {
        return failed(provider);
    }
}

async function generateCommitMessage(
    gitService: GitService,
    repoPath: string,
    includeUnstaged: boolean,
    generate: (diff: string) => Promise<string>,
): Promise<string> {
    const diffResult = await gitService.diff(repoPath);
    const files = includeUnstaged ? diffResult.files : diffResult.files.filter((f) => f.staged);
    if (files.some((file) => file.state === "tooLarge")) {
        throw new Error("Cannot generate commit message: a file diff exceeds 1 MiB");
    }
    const diffText = files.map((f) => f.diff).join("\n");
    if (!diffText.trim()) {
        throw new Error("No changes to commit");
    }

    try {
        return await generate(diffText);
    } catch {
        throw new Error("Failed to generate commit message");
    }
}

export { commit, pushBranch as push, createPr, checkBranchPr, generateCommitMessage };
