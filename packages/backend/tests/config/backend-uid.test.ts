import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { readOrCreateBackendUid } from "../../src/config";

const CONFIG_MODULE = resolve(import.meta.dir, "../../src/config.ts");

/** Runs a script in a fresh bun process whose config base dir is `baseDir`. */
async function runWithConfigDir(baseDir: string, script: string): Promise<string> {
    const child = Bun.spawn([process.execPath, "-e", script], {
        env: {
            ...process.env,
            TASKFLOW_CONFIG_DIR: baseDir,
            TASKFLOW_DEV: "",
            TASKFLOW_DEV_BRANCH: "",
        },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (exitCode !== 0) throw new Error(`child exited ${exitCode}: ${stderr}`);
    return stdout.trim();
}

describe("readOrCreateBackendUid", () => {
    test("mints a uid once and returns the same one afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            const first = readOrCreateBackendUid(dir, "main");
            const second = readOrCreateBackendUid(dir, "main");
            expect(first).toBe(second);
            expect(first).toMatch(/^[0-9a-f]{32}$/);
            expect((await readFile(join(dir, "backend-uid-main"), "utf-8")).trim()).toBe(first);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("two base directories get different uids", async () => {
        const a = await mkdtemp(join(tmpdir(), "uid-a-"));
        const b = await mkdtemp(join(tmpdir(), "uid-b-"));
        try {
            expect(readOrCreateBackendUid(a, "main")).not.toBe(readOrCreateBackendUid(b, "main"));
        } finally {
            await rm(a, { recursive: true, force: true });
            await rm(b, { recursive: true, force: true });
        }
    });

    test("two instances in one base directory get different uids", async () => {
        // main and dev-* share BASE_DIR (and the data dir). One uid between them
        // would make adoptUid merge them into a single record.
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            expect(readOrCreateBackendUid(dir, "main")).not.toBe(
                readOrCreateBackendUid(dir, "dev-feature-x"),
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("replaces a file that holds no valid uid", async () => {
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            await writeFile(join(dir, "backend-uid-main"), "not a uid");
            const uid = readOrCreateBackendUid(dir, "main");
            expect(uid).toMatch(/^[0-9a-f]{32}$/);
            expect((await readFile(join(dir, "backend-uid-main"), "utf-8")).trim()).toBe(uid);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("backends starting at the same moment agree on one uid", async () => {
        // Each child busy-waits until a shared instant, then mints. Without an
        // exclusive create every child sees no file, mints its own uid and
        // reports it, so one backend would be announced under several identities.
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        const uidDir = join(dir, "uids");
        try {
            const startAt = Date.now() + 1500;
            const script =
                `const { readOrCreateBackendUid } = await import(${JSON.stringify(CONFIG_MODULE)});` +
                `while (Date.now() < ${startAt}) {}` +
                `console.log(readOrCreateBackendUid(${JSON.stringify(uidDir)}, "main"));`;
            const uids = await Promise.all(
                Array.from({ length: 6 }, () => runWithConfigDir(dir, script)),
            );
            expect(new Set(uids).size).toBe(1);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30_000);
});

describe("config.backendUid", () => {
    test("importing config writes no uid file; reading backendUid mints it", async () => {
        // Every module that imports config (routes, handlers, their tests) would
        // otherwise write into the real config directory: the test preload's HOME
        // override does not reach os.homedir().
        const dir = await mkdtemp(join(tmpdir(), "uid-config-"));
        try {
            const importOnly = `await import(${JSON.stringify(CONFIG_MODULE)});`;
            await runWithConfigDir(dir, importOnly);
            expect((await readdir(dir)).filter((name) => name.startsWith("backend-uid-"))).toEqual(
                [],
            );

            const readUid =
                `const { config } = await import(${JSON.stringify(CONFIG_MODULE)});` +
                `console.log(config.backendUid);`;
            const uid = await runWithConfigDir(dir, readUid);
            expect(uid).toMatch(/^[0-9a-f]{32}$/);
            expect((await readFile(join(dir, "backend-uid-main"), "utf-8")).trim()).toBe(uid);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
