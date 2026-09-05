import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { MSG } from "@taskflow/shared";
import type { SessionRef } from "@taskflow/shared";
import { TaskStore } from "../task-store";
import { createSessionLifecycle } from "../session-lifecycle";
import type { PtyManager } from "../pty-manager";
import type { SettingsStore } from "../settings-store";
import type { TrayStateTracker } from "../tray-state-tracker";
import type { GitService } from "../git-service";
import { registerTaskHandlers } from "../../handlers/task";
import { Router } from "../../ws/router";
import { config } from "../../config";

// Repro: session output logs are only deleted by removeSessionFromOwner when
// the owner still lists the session. Two common paths drop the session from
// its owner first, so the log is orphaned forever:
//   1. TASK_ARCHIVE clears task.sessions before closing the PTYs.
//   2. On restart, reconcileInterruptedSessions drops every shell session.
// On a real data dir this left 976 orphan logs (886 MB) next to 4 live ones.

let dir: string;
let store: TaskStore;

const exists = (path: string) =>
    stat(path).then(
        () => true,
        () => false,
    );

async function waitForRemoval(path: string): Promise<boolean> {
    for (let i = 0; i < 20; i += 1) {
        if (!(await exists(path))) return false;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return exists(path);
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-leak-"));
    for (const sub of ["tasks", "archive", "task-logs", "session-logs", "repo"]) {
        await mkdir(join(dir, sub), { recursive: true });
    }
    store = new TaskStore({
        projectsFile: join(dir, "projects.json"),
        tasksDir: join(dir, "tasks"),
        archiveDir: join(dir, "archive"),
        taskLogsDir: join(dir, "task-logs"),
        sessionLogsDir: join(dir, "session-logs"),
        masterSessionsFile: join(dir, "master.json"),
    });
    await store.init();
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

test("archiving a task with a live shell session deletes the session's log", async () => {
    const project = await store.addProject({ path: join(dir, "repo") });
    const task = await store.createTask({ projectId: project.id, title: "t", description: "" });

    // PTY stand-in: `close` fires the exit callback the way a real process exit does.
    const exits = new Map<string, (exitCode: number) => void>();
    const ptyManager = {
        spawn(opts: { id?: string; onExit: (exitCode: number) => void }) {
            exits.set(opts.id ?? "", opts.onExit);
            return opts.id ?? "";
        },
        close(id: string) {
            const onExit = exits.get(id);
            exits.delete(id);
            onExit?.(0);
        },
        has(id: string) {
            return exits.has(id);
        },
    } as unknown as PtyManager;
    const noop = () => undefined;
    const lifecycle = createSessionLifecycle({
        ptyManager,
        taskStore: store,
        settingsStore: {} as SettingsStore,
        broadcast: noop,
        getPort: () => 0,
        detectedEditors: [],
        trayStateTracker: {
            registerSession: noop,
            markSessionActivity: noop,
            clearSession: noop,
        } as unknown as TrayStateTracker,
    });

    const sessionId = await lifecycle.createSession({
        owner: { taskId: task.id },
        type: "shell",
        shell: "/bin/sh",
    });
    await store.appendSessionOutput(task.id, sessionId, 1, "hello\r\n");
    const logPath = join(dir, "session-logs", `${task.id}--${sessionId}.jsonl`);
    expect(await exists(logPath)).toBe(true);

    const router = new Router();
    registerTaskHandlers({
        router,
        store,
        gitService: {} as GitService,
        closeSession: (id) => ptyManager.close(id),
    });
    await router.handle(MSG.TASK_ARCHIVE, { id: task.id });

    const archived = await store.getArchived(task.id);
    expect(archived?.sessions).toEqual([]);
    expect(await waitForRemoval(logPath)).toBe(false);
});

test("restart reconciliation that drops a shell session deletes its log", async () => {
    const task = await store.createTask({ projectId: "p1", title: "t", description: "" });
    const session: SessionRef = {
        id: "shell-1",
        type: "shell",
        label: "zsh",
        createdAt: new Date().toISOString(),
        instance: config.instanceId,
        bootId: "boot-1",
        state: "live",
    };
    await store.updateTask(task.id, { sessions: [session] });
    await store.appendSessionOutput(task.id, session.id, 1, "hello\r\n");
    const logPath = join(dir, "session-logs", `${task.id}--${session.id}.jsonl`);

    await store.reconcileInterruptedSessions(config.instanceId, "boot-2");

    expect((await store.getTask(task.id))?.sessions).toEqual([]);
    expect(await exists(logPath)).toBe(false);
});

test("restart reconciliation keeps the log of an agent session it marks interrupted", async () => {
    const task = await store.createTask({ projectId: "p1", title: "t", description: "" });
    const session: SessionRef = {
        id: "claude-1",
        type: "claude",
        label: "Claude",
        createdAt: new Date().toISOString(),
        instance: config.instanceId,
        bootId: "boot-1",
        state: "live",
        nativeSessionId: "claude-1",
    };
    await store.updateTask(task.id, { sessions: [session] });
    await store.appendSessionOutput(task.id, session.id, 1, "hello\r\n");
    const logPath = join(dir, "session-logs", `${task.id}--${session.id}.jsonl`);

    await store.reconcileInterruptedSessions(config.instanceId, "boot-2");

    expect((await store.getTask(task.id))?.sessions[0]?.state).toBe("interrupted");
    expect(await exists(logPath)).toBe(true);
});

test("the boot sweep removes logs nothing references and keeps the rest", async () => {
    const project = await store.addProject({ path: join(dir, "repo") });
    const task = await store.createTask({ projectId: project.id, title: "t", description: "" });
    const live: SessionRef = {
        id: "live-1",
        type: "claude",
        label: "Claude",
        createdAt: new Date().toISOString(),
        instance: config.instanceId,
        bootId: "boot-1",
        state: "interrupted",
        nativeSessionId: "live-1",
    };
    await store.updateTask(task.id, { sessions: [live] });
    await store.updateProject(project.id, { sessions: [{ ...live, id: "live-2" }] });
    await store.addMasterSession({ ...live, id: "live-3" });

    await store.appendSessionOutput(task.id, "live-1", 1, "a");
    await store.appendSessionOutput(project.id, "live-2", 1, "b");
    await store.appendSessionOutput("master", "live-3", 1, "c");
    await store.appendSessionOutput(task.id, "gone-1", 1, "d");
    await store.appendSessionOutput("deleted-task", "gone-2", 1, "e");
    await store.appendSessionOutput("master", "gone-3", 1, "f");

    const swept = await store.sweepOrphanSessionLogs();

    expect(swept).toBe(3);
    const logs = join(dir, "session-logs");
    expect(await exists(join(logs, `${task.id}--live-1.jsonl`))).toBe(true);
    expect(await exists(join(logs, `${project.id}--live-2.jsonl`))).toBe(true);
    expect(await exists(join(logs, "master--live-3.jsonl"))).toBe(true);
    expect(await exists(join(logs, `${task.id}--gone-1.jsonl`))).toBe(false);
    expect(await exists(join(logs, "deleted-task--gone-2.jsonl"))).toBe(false);
    expect(await exists(join(logs, "master--gone-3.jsonl"))).toBe(false);
});
