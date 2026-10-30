import { describe, expect, it } from "bun:test";
import { createGitRunner, GitQueryLimitError } from "../../src/services/git-helpers";
import { expectRejects } from "../expect-rejects";

function harness(autoFinishOnKill = true, keepPipesOpenOnKill = false) {
    let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
    let stderrController!: ReadableStreamDefaultController<Uint8Array>;
    let resolveExit!: (code: number) => void;
    let timerCallback: (() => void) | undefined;
    const state = {
        kills: 0,
        timers: [] as number[],
        cancellations: 0,
        pipeCancellations: [] as string[],
        argv: [] as string[],
        cwd: "",
    };
    const stdout = new ReadableStream<Uint8Array>({
        start(controller) {
            stdoutController = controller;
        },
        cancel() {
            state.pipeCancellations.push("stdout");
        },
    });
    const stderr = new ReadableStream<Uint8Array>({
        start(controller) {
            stderrController = controller;
        },
        cancel() {
            state.pipeCancellations.push("stderr");
        },
    });
    const exited = new Promise<number>((resolve) => {
        resolveExit = resolve;
    });
    const finish = (code = 0) => {
        stdoutController.close();
        stderrController.close();
        resolveExit(code);
    };
    const runner = createGitRunner({
        spawn(argv, cwd) {
            state.argv = argv;
            state.cwd = cwd;
            return {
                stdout,
                stderr,
                exited,
                kill() {
                    state.kills += 1;
                    if (autoFinishOnKill) {
                        if (keepPipesOpenOnKill) resolveExit(143);
                        else finish(143);
                    }
                },
            };
        },
        timer(callback, delayMs) {
            timerCallback = callback;
            state.timers.push(delayMs);
            return () => {
                state.cancellations += 1;
            };
        },
    });
    return {
        ...runner,
        state,
        finish,
        pipes: [stdout, stderr],
        stdout: (bytes: Uint8Array) => stdoutController.enqueue(bytes),
        stderr: (bytes: Uint8Array) => stderrController.enqueue(bytes),
        fireTimer: () => {
            if (!timerCallback) throw new Error("No timer scheduled");
            timerCallback();
        },
    };
}

describe("Git query runner", () => {
    it("literal pathspec option precedes the git subcommand", async () => {
        const proc = harness();
        const result = proc.git(["add", "--", "route[ab].txt"], "/repo", {
            literalPathspecs: true,
        });
        proc.finish();
        await result;
        expect(proc.state.argv).toEqual([
            "git",
            "--no-optional-locks",
            "--literal-pathspecs",
            "add",
            "--",
            "route[ab].txt",
        ]);
        expect(proc.state.cwd).toBe("/repo");

        const ordinary = harness();
        const ordinaryResult = ordinary.git(["status"], "/repo");
        ordinary.finish();
        await ordinaryResult;
        expect(ordinary.state.argv).toEqual(["git", "--no-optional-locks", "status"]);
    });

    it("read-only query kills and rejects at 30000 milliseconds", async () => {
        const proc = harness();
        const result = proc.git(["status"], "/repo", { readOnly: true });
        expect(proc.state.timers).toEqual([30000]);
        proc.fireTimer();
        await expectRejects(result, "Git query timed out after 30 seconds");
        expect(proc.state.kills).toBe(1);
        expect(proc.state.cancellations).toBe(1);
        expect(await result.catch((error: unknown) => error)).toBeInstanceOf(GitQueryLimitError);
        const error = await result.catch((caught: unknown) => caught);
        if (!(error instanceof GitQueryLimitError)) throw new Error("Expected query limit error");
        expect(error.reason).toBe("timeout");
    });

    it("timeout settles after Git exits even when helpers keep both pipes open", async () => {
        const proc = harness(true, true);
        const result = proc.git(["status"], "/repo", { readOnly: true });
        let settled = false;
        const observed = result.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        proc.fireTimer();
        // Flush the promise continuations without advancing a real clock.
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
        try {
            expect(settled).toBe(true);
            expect(proc.state.pipeCancellations.sort()).toEqual(["stderr", "stdout"]);
            expect(proc.pipes.every((pipe) => !pipe.locked)).toBe(true);
            expect(proc.state.kills).toBe(1);
            expect(proc.state.cancellations).toBe(1);
        } finally {
            if (!settled) proc.finish(143);
            await observed;
        }
        await expectRejects(result, "Git query timed out after 30 seconds");
    });

    it("combined stdout and stderr cannot exceed 32 MiB", async () => {
        const exact = harness();
        const exactResult = exact.gitCapture(["diff"], "/repo", { readOnly: true });
        exact.stdout(new Uint8Array(16 * 1024 * 1024).fill(97));
        exact.stderr(new Uint8Array(16 * 1024 * 1024).fill(98));
        exact.finish();
        const output = await exactResult;
        expect(output.stdout.length + output.stderr.length).toBe(32 * 1024 * 1024);
        expect(exact.state.kills).toBe(0);
        expect(exact.state.cancellations).toBe(1);

        const overflow = harness();
        const overflowResult = overflow.gitCapture(["diff"], "/repo", { readOnly: true });
        overflow.stdout(new Uint8Array(16 * 1024 * 1024));
        overflow.stderr(new Uint8Array(16 * 1024 * 1024 + 1));
        await expectRejects(overflowResult, "Git query output exceeds 32 MiB");
        expect(overflow.state.kills).toBe(1);
    });

    it("a multi-byte chunk is counted as bytes", async () => {
        const proc = harness();
        const result = proc.git(["show"], "/repo", { readOnly: true, maxOutputBytes: 3 });
        proc.stdout(new TextEncoder().encode("éé"));
        await expectRejects(result, "Git query output limit exceeded");
        const error = await result.catch((caught: unknown) => caught);
        if (!(error instanceof GitQueryLimitError)) throw new Error("Expected query limit error");
        expect(error.reason).toBe("output");
        expect(proc.state.kills).toBe(1);
    });

    it("overflow drains both pipes and reaps the process", async () => {
        const proc = harness(false);
        const result = proc.gitCapture(["diff"], "/repo", { readOnly: true, maxOutputBytes: 1 });
        let settled = false;
        const observed = result.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        proc.stdout(new Uint8Array(2));
        await Bun.sleep(0);
        expect(proc.state.kills).toBe(1);
        expect(settled).toBe(false);
        proc.stdout(new Uint8Array(2));
        proc.stderr(new Uint8Array(2));
        await Bun.sleep(0);
        expect(settled).toBe(false);
        proc.finish(143);
        await observed;
        await expectRejects(result, "Git query output limit exceeded");
        expect(proc.state.kills).toBe(1);
        expect(proc.state.cancellations).toBe(1);
    });

    it("allowed exit codes still work", async () => {
        const allowed = harness();
        const allowedResult = allowed.git(["diff", "--no-index"], "/repo", {
            readOnly: true,
            allowExitCodes: [1],
        });
        allowed.stdout(new TextEncoder().encode("patch"));
        allowed.finish(1);
        expect(await allowedResult).toBe("patch");

        const failure = harness();
        const failureResult = failure.git(["status"], "/repo", { readOnly: true });
        failure.stderr(new TextEncoder().encode("fatal query failure\n"));
        failure.finish(128);
        await expectRejects(failureResult, "fatal query failure");
        expect(failure.state.cancellations).toBe(1);
    });

    it("a mutating command has no query deadline", async () => {
        const proc = harness();
        const result = proc.git(["commit", "-m", "message"], "/repo");
        expect(proc.state.timers).toEqual([]);
        proc.finish();
        await result;
        expect(proc.state.kills).toBe(0);
        expect(proc.state.cancellations).toBe(0);
    });
});
