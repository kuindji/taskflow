interface GitRunOptions {
    allowExitCodes?: number[];
    literalPathspecs?: boolean;
    readOnly?: boolean;
    maxOutputBytes?: number;
    /** Observe raw stdout bytes before UTF-8 decoding, for preview binary detection. */
    onStdout?(chunk: Uint8Array): void;
}

class GitQueryLimitError extends Error {
    constructor(
        readonly reason: "timeout" | "output",
        message: string,
    ) {
        super(message);
        this.name = "GitQueryLimitError";
    }
}

interface GitRunnerDependencies {
    spawn(
        argv: string[],
        cwd: string,
    ): {
        stdout: ReadableStream<Uint8Array>;
        stderr: ReadableStream<Uint8Array>;
        exited: Promise<number>;
        kill(): void;
    };
    timer(callback: () => void, delayMs: number): () => void;
}

const QUERY_TIMEOUT_MS = 30_000;
const QUERY_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

function createGitRunner(deps: GitRunnerDependencies) {
    async function gitCapture(
        args: string[],
        cwd: string,
        options: GitRunOptions = {},
    ): Promise<{ stdout: string; stderr: string }> {
        const argv = ["git", "--no-optional-locks"];
        if (options.literalPathspecs) argv.push("--literal-pathspecs");
        const proc = deps.spawn([...argv, ...args], cwd);
        const maxOutputBytes = Math.min(
            options.readOnly ? QUERY_MAX_OUTPUT_BYTES : Infinity,
            options.maxOutputBytes ?? Infinity,
        );
        let outputBytes = 0;
        let failure: { error: unknown } | undefined;
        let processExited = false;
        const readers = [proc.stdout.getReader(), proc.stderr.getReader()];
        let readerCancellation: Promise<PromiseSettledResult<void>[]> | undefined;
        const cancelReadersAfterExit = () => {
            if (processExited && failure) {
                // Helpers can inherit these pipes and keep them open after Git exits.
                readerCancellation ??= Promise.allSettled(readers.map((reader) => reader.cancel()));
            }
        };
        const fail = (error: unknown) => {
            if (failure) return;
            failure = { error };
            try {
                proc.kill();
            } catch {
                // Preserve the query failure if the process already exited.
            }
            cancelReadersAfterExit();
        };
        const cancelTimer = options.readOnly
            ? deps.timer(() => {
                  fail(new GitQueryLimitError("timeout", "Git query timed out after 30 seconds"));
              }, QUERY_TIMEOUT_MS)
            : undefined;

        const read = async (
            reader: ReadableStreamDefaultReader<Uint8Array>,
            stdout = false,
        ): Promise<string> => {
            const decoder = new TextDecoder();
            const chunks: string[] = [];
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (stdout) options.onStdout?.(value);
                    outputBytes += value.byteLength;
                    if (outputBytes > maxOutputBytes) {
                        fail(
                            new GitQueryLimitError(
                                "output",
                                maxOutputBytes < QUERY_MAX_OUTPUT_BYTES
                                    ? "Git query output limit exceeded"
                                    : "Git query output exceeds 32 MiB",
                            ),
                        );
                    }
                    if (failure) chunks.length = 0;
                    else chunks.push(decoder.decode(value, { stream: true }));
                }
                if (failure) return "";
                chunks.push(decoder.decode());
                return chunks.join("");
            } catch (error) {
                fail(error);
                throw error;
            } finally {
                reader.releaseLock();
            }
        };

        try {
            const [stdoutResult, stderrResult, exitResult] = await Promise.allSettled([
                read(readers[0], true),
                read(readers[1]),
                proc.exited
                    .catch((error: unknown) => {
                        fail(error);
                        throw error;
                    })
                    .finally(() => {
                        processExited = true;
                        cancelReadersAfterExit();
                    }),
            ]);
            await readerCancellation;
            if (failure) throw failure.error;
            if (stdoutResult.status === "rejected") throw stdoutResult.reason;
            if (stderrResult.status === "rejected") throw stderrResult.reason;
            if (exitResult.status === "rejected") throw exitResult.reason;
            const stdout = stdoutResult.value;
            const stderr = stderrResult.value;
            const exitCode = exitResult.value;
            if (exitCode !== 0 && !options.allowExitCodes?.includes(exitCode)) {
                throw new Error(
                    stderr.trim() ||
                        stdout.trim() ||
                        `git ${args.join(" ")} failed with exit code ${exitCode}`,
                );
            }
            return { stdout, stderr };
        } finally {
            cancelTimer?.();
        }
    }

    async function git(args: string[], cwd: string, options: GitRunOptions = {}): Promise<string> {
        const { stdout } = await gitCapture(args, cwd, options);
        return stdout;
    }

    return { git, gitCapture };
}

const { git, gitCapture } = createGitRunner({
    spawn: (argv, cwd) => Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" }),
    timer: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs);
        return () => clearTimeout(timer);
    },
});

interface NumstatEntry {
    path: string;
    additions: number;
    deletions: number;
}

export { git, gitCapture, createGitRunner, GitQueryLimitError, type GitRunOptions, NumstatEntry };
