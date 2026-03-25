async function git(
    args: string[],
    cwd: string,
    options: { allowExitCodes?: number[] } = {},
): Promise<string> {
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
    return stdout;
}

interface NumstatEntry {
    path: string;
    additions: number;
    deletions: number;
}

export { git, NumstatEntry };
