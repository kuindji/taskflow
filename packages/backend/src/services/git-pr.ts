import { git } from "./git-helpers";
import type { GitService } from "./git-service";

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
    const hashOutput = await git(["rev-parse", "--short", "HEAD"], repoPath);
    if (push) {
        await git(["push"], repoPath);
    }
    return { hash: hashOutput.trim(), message };
}

async function createPr(
    repoPath: string,
    title: string,
    body?: string,
): Promise<{ url: string; number: number }> {
    const args = ["pr", "create", "--title", title];
    if (body) {
        args.push("--body", body);
    } else {
        args.push("--body", "");
    }
    const proc = Bun.spawn(["gh", ...args], { cwd: repoPath, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) {
        throw new Error(
            stderr.trim() || stdout.trim() || `gh pr create failed with exit code ${exitCode}`,
        );
    }
    const url = stdout.trim();
    const prNumberMatch = url.match(/\/pull\/(\d+)/);
    const number = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;
    return { url, number };
}

async function checkBranchPr(
    repoPath: string,
    branch: string,
): Promise<{ url: string; number: number } | null> {
    const proc = Bun.spawn(
        ["gh", "pr", "list", "--head", branch, "--json", "number,url", "--limit", "1"],
        { cwd: repoPath, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0) return null;
    try {
        const prs = JSON.parse(stdout.trim()) as Array<{ number: number; url: string }>;
        if (prs.length === 0) return null;
        return { number: prs[0].number, url: prs[0].url };
    } catch {
        return null;
    }
}

async function generateCommitMessage(
    gitService: GitService,
    repoPath: string,
    includeUnstaged = true,
): Promise<string> {
    const diffResult = await gitService.diff(repoPath);
    const files = includeUnstaged ? diffResult.files : diffResult.files.filter((f) => f.staged);
    const diffText = files.map((f) => f.diff).join("\n");
    if (!diffText.trim()) {
        throw new Error("No changes to commit");
    }

    const prompt = [
        "Generate a concise git commit message for the following changes.",
        "Output ONLY the commit message — no explanation, no markdown, no quotes.",
        "Use conventional commit format (e.g. feat:, fix:, refactor:).",
        "",
        diffText,
    ].join("\n");

    const env: Record<string, string | undefined> = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const proc = Bun.spawn(["claude", "-p", prompt], {
        cwd: repoPath,
        stdout: "pipe",
        stderr: "pipe",
        env,
    });
    const [stdout, , exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0 || !stdout.trim()) {
        throw new Error("Failed to generate commit message");
    }
    return stdout.trim();
}

export { commit, createPr, checkBranchPr, generateCommitMessage };
