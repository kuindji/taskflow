import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { TaskStore } from "../task-store";

// Deliberately skipped (Sep 2026): the data dir is moving off cloud storage,
// which is the only realistic source of a torn projects.json, so this class of
// failure is accepted for now. Unskip to see the current behaviour.
//
// Repro: listProjects() returns [] when projects.json does not parse. readTask()
// deliberately tolerates unparsable files because a half-materialised file from
// cloud storage is a real, transient condition — but every projects mutation
// (addProject, updateProject, removeProject, reorderProjects) does
// listProjects() → modify → write, so a transient parse failure at that moment
// rewrites projects.json with only the surviving mutation and every other
// project is gone. The same shape exists for the master sessions file.

let dir: string;
let store: TaskStore;

async function projectDir(name: string): Promise<string> {
    const path = join(dir, "repos", name);
    await mkdir(path, { recursive: true });
    return path;
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-projects-"));
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

test.skip("addProject over an unparsable projects.json must not discard the existing projects", async () => {
    await store.addProject({ path: await projectDir("a") });
    await store.addProject({ path: await projectDir("b") });
    await store.addProject({ path: await projectDir("c") });

    // Simulate a torn read: the file is mid-write by another process/machine.
    const projectsFile = join(dir, "projects.json");
    const intact = await readFile(projectsFile, "utf-8");
    await writeFile(projectsFile, intact.slice(0, intact.length - 20));

    let error: unknown = null;
    try {
        await store.addProject({ path: await projectDir("d") });
    } catch (e) {
        error = e;
    }

    // Either outcome is acceptable: refuse the mutation, or (if the file has
    // healed) apply it. Silently writing a one-project file is not.
    const after = JSON.parse(await readFile(projectsFile, "utf-8")) as unknown[];
    if (error === null) {
        expect(after.length).toBe(4);
    } else {
        expect(after.length).toBeGreaterThanOrEqual(1);
        expect(error).toBeInstanceOf(Error);
    }
    expect(after.length).not.toBe(1);
});

test.skip("reorderProjects over an unparsable projects.json must not empty the file", async () => {
    const a = await store.addProject({ path: await projectDir("a") });
    const b = await store.addProject({ path: await projectDir("b") });

    const projectsFile = join(dir, "projects.json");
    await writeFile(projectsFile, '[{"id": "' + a.id);

    let threw = false;
    try {
        await store.reorderProjects([b.id, a.id]);
    } catch {
        threw = true;
    }

    const raw = await readFile(projectsFile, "utf-8");
    if (!threw) {
        expect((JSON.parse(raw) as unknown[]).length).toBe(2);
    }
    expect(raw).not.toBe("[]");
});
