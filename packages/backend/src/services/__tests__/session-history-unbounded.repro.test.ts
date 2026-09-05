import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TaskStore } from "../task-store";

// Regression: a session's output log used to be appended to for the whole life
// of the session and never compacted, and getSessionHistory read and returned
// all of it. On a real data dir a single log reached 66 MB; reading it took
// ~9 s of mostly synchronous work on the backend and produced a 55 MB
// WebSocket frame. The pty-manager keeps at most 50_000 chars of scrollback, so
// anything beyond a bounded tail is wasted work.

// Mirrors the constants in task-store.ts: the read tail is 256 KB, the log is
// compacted past 4 MB. The assertions leave slack so the test pins behaviour,
// not the exact numbers.
const HISTORY_READ_CAP_CHARS = 300_000;
const LOG_FILE_CAP_BYTES = 4 * 1024 * 1024 + 64 * 1024;

let dir: string;
let store: TaskStore;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-history-"));
    for (const sub of ["tasks", "archive", "task-logs", "session-logs"]) {
        await mkdir(join(dir, sub), { recursive: true });
    }
    store = new TaskStore({
        projectsFile: join(dir, "projects.json"),
        tasksDir: join(dir, "tasks"),
        archiveDir: join(dir, "archive"),
        taskLogsDir: join(dir, "task-logs"),
        sessionLogsDir: join(dir, "session-logs"),
    });
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

test("getSessionHistory returns a bounded tail, not the whole log", async () => {
    const chunk = "x".repeat(10_000);
    const entries = 300; // 3 MB of output, a few minutes of a busy agent
    for (let sequence = 1; sequence <= entries; sequence += 1) {
        await store.appendSessionOutput("task-1", "session-1", sequence, chunk);
    }

    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");

    expect(lastSequence).toBe(entries);
    expect(data.endsWith(chunk)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(HISTORY_READ_CAP_CHARS);
});

test("a tail read never starts inside a record", async () => {
    // Records of varying length so the byte cut lands mid-line.
    for (let sequence = 1; sequence <= 2_000; sequence += 1) {
        await store.appendSessionOutput(
            "task-1",
            "session-1",
            sequence,
            `${sequence}:` + "y".repeat(sequence % 700),
        );
    }

    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");

    expect(lastSequence).toBe(2_000);
    // Every record starts with its own sequence, so the first char of the
    // tail must be the start of some record's data — a digit — not a fragment.
    expect(data).toMatch(/^\d+:/);
    expect(data.endsWith("2000:" + "y".repeat(2000 % 700))).toBe(true);
});

test("a single record larger than the read window is still returned", async () => {
    // One PTY batch bigger than the 256 KB tail. Reading a fixed window would
    // find no complete line inside it and report an empty history with
    // lastSequence 0, which on resume would restart the sequence counter and
    // make the client replay chunks it should discard.
    const huge = "h".repeat(600_000);
    await store.appendSessionOutput("task-1", "session-1", 1, "before");
    await store.appendSessionOutput("task-1", "session-1", 2, huge);

    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");

    expect(lastSequence).toBe(2);
    expect(data.endsWith(huge)).toBe(true);
});

test("a short log is returned whole", async () => {
    for (let sequence = 1; sequence <= 5; sequence += 1) {
        await store.appendSessionOutput("task-1", "session-1", sequence, `line ${sequence}\n`);
    }

    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");

    expect(lastSequence).toBe(5);
    expect(data).toBe("line 1\nline 2\nline 3\nline 4\nline 5\n");
});

test("the on-disk session log itself stays bounded", async () => {
    const chunk = "x".repeat(10_000);
    for (let sequence = 1; sequence <= 600; sequence += 1) {
        await store.appendSessionOutput("task-1", "session-1", sequence, chunk);
    }

    const logPath = join(dir, "session-logs", "task-1--session-1.jsonl");
    const { size } = await stat(logPath);
    expect(size).toBeLessThanOrEqual(LOG_FILE_CAP_BYTES);

    // Compaction must keep the newest output intact and readable.
    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");
    expect(lastSequence).toBe(600);
    expect(data.endsWith(chunk)).toBe(true);
});

test("compaction picks up a log that already exists on disk", async () => {
    // A log left by a previous backend process: size is unknown to this store.
    const logPath = join(dir, "session-logs", "task-1--session-1.jsonl");
    const big = JSON.stringify({ sequence: 1, data: "z".repeat(5 * 1024 * 1024) }) + "\n";
    await writeFile(logPath, big);

    await store.appendSessionOutput("task-1", "session-1", 2, "after");

    const { size } = await stat(logPath);
    expect(size).toBeLessThanOrEqual(LOG_FILE_CAP_BYTES);
    const { data, lastSequence } = await store.getSessionHistory("task-1", "session-1");
    expect(lastSequence).toBe(2);
    expect(data.endsWith("after")).toBe(true);
});
