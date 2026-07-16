interface GitRunOptions {
    allowExitCodes?: number[];
}

async function gitCapture(
    args: string[],
    cwd: string,
    options: GitRunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
    const proc = Bun.spawn(["git", "--no-optional-locks", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    if (exitCode !== 0 && !options.allowExitCodes?.includes(exitCode)) {
        throw new Error(
            stderr.trim() ||
                stdout.trim() ||
                `git ${args.join(" ")} failed with exit code ${exitCode}`,
        );
    }
    return { stdout, stderr };
}

async function git(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
    const { stdout } = await gitCapture(args, cwd, options);
    return stdout;
}

interface NumstatEntry {
    path: string;
    additions: number;
    deletions: number;
}

export { git, gitCapture, NumstatEntry };
