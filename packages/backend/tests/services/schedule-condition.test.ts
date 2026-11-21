import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { expectRejects } from "../expect-rejects";
import { join } from "path";
import { tmpdir } from "os";
import {
    normalizeConditionScript,
    runScheduleCondition,
} from "../../src/services/schedule-condition";

let dir: string;
let controller: AbortController;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "schedule-condition-"));
    controller = new AbortController();
});
afterEach(async () => {
    controller.abort();
    await rm(dir, { recursive: true, force: true });
});
function run(script: string, timeoutMs?: number) {
    return runScheduleCondition(script, {
        cwd: dir,
        env: { ...process.env, TASKFLOW_SCHEDULE_ID: "schedule-test" },
        shell: "/bin/sh",
        signal: controller.signal,
        timeoutMs,
    });
}

it("normalizes absent and blank conditions and rejects other types", () => {
    for (const value of [undefined, null, "", " \n "])
        expect(normalizeConditionScript(value)).toBeUndefined();
    expect(normalizeConditionScript(" echo ok\n")).toBe(" echo ok\n");
    expect(() => normalizeConditionScript(false)).toThrow("conditionScript");
});
it.skipIf(process.platform === "win32")(
    "uses exit codes, project cwd, and supplied environment",
    async () => {
        expect(await run('printf "%s" "$TASKFLOW_SCHEDULE_ID" > checked; test -s checked')).toBe(
            true,
        );
        expect(await readFile(join(dir, "checked"), "utf8")).toBe("schedule-test");
        expect(await run("test -f missing")).toBe(false);
        // Text output does not control the decision.
        expect(await run("echo false; exit 0")).toBe(true);
        expect(await run("echo true; exit 1")).toBe(false);
    },
);
it.skipIf(process.platform === "win32")("reports script and spawn errors", async () => {
    await expectRejects(run("echo unavailable >&2; exit 2"), "code 2: unavailable");
    await expectRejects(run("taskflow_missing_condition_command"), "code 127");
    await expectRejects(
        runScheduleCondition("exit 0", {
            cwd: join(dir, "missing"),
            env: process.env,
            signal: controller.signal,
            shell: "/bin/sh",
        }),
    );
});
it.skipIf(process.platform === "win32")(
    "drains large output with bounded diagnostics",
    async () => {
        await expectRejects(run("yes diagnostic | head -c 100000 >&2; exit 2"), "code 2");
        expect(await run("yes output | head -c 100000")).toBe(true);
    },
);
it.skipIf(process.platform === "win32")("times out the shell and its check command", async () => {
    await expectRejects(run("sleep 0.3; touch escaped", 30), "timed out");
    await Bun.sleep(400);
    expect(await Bun.file(join(dir, "escaped")).exists()).toBe(false);
});
it.skipIf(process.platform === "win32")("cancels the shell and its check command", async () => {
    const pending = run("sleep 0.3; touch escaped");
    controller.abort();
    await expectRejects(pending, "cancelled");
    await Bun.sleep(400);
    expect(await Bun.file(join(dir, "escaped")).exists()).toBe(false);
});
