import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { readOrCreateApiToken } from "../../src/config";

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

/**
 * Six children busy-wait until a shared instant, then each mints into `tokenDir`.
 * Returns how many distinct tokens they reported.
 */
async function mintConcurrently(baseDir: string, tokenDir: string): Promise<number> {
    const startAt = Date.now() + 1500;
    const script =
        `const { readOrCreateApiToken } = await import(${JSON.stringify(CONFIG_MODULE)});` +
        `while (Date.now() < ${startAt}) {}` +
        `console.log(readOrCreateApiToken(${JSON.stringify(tokenDir)}, "main"));`;
    const tokens = await Promise.all(
        Array.from({ length: 6 }, () => runWithConfigDir(baseDir, script)),
    );
    return new Set(tokens).size;
}

describe("readOrCreateApiToken", () => {
    test("mints a 43-character base64url token once and returns the same one afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "token-"));
        try {
            const first = readOrCreateApiToken(dir, "main");
            const second = readOrCreateApiToken(dir, "main");
            expect(first).toBe(second);
            expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect((await readFile(join(dir, "api-token-main"), "utf-8")).trim()).toBe(first);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("two instances in one base directory get different tokens", async () => {
        // main and dev-* share BASE_DIR but must authenticate independently.
        const dir = await mkdtemp(join(tmpdir(), "token-"));
        try {
            expect(readOrCreateApiToken(dir, "main")).not.toBe(
                readOrCreateApiToken(dir, "dev-feature-x"),
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test.skipIf(process.platform === "win32")("the token file is mode 0600", async () => {
        const dir = await mkdtemp(join(tmpdir(), "token-mode-"));
        try {
            readOrCreateApiToken(dir, "main");
            expect((await stat(join(dir, "api-token-main"))).mode & 0o777).toBe(0o600);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("replaces a file that holds no valid token", async () => {
        const dir = await mkdtemp(join(tmpdir(), "token-"));
        try {
            await writeFile(join(dir, "api-token-main"), "not a token");
            const token = readOrCreateApiToken(dir, "main");
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect((await readFile(join(dir, "api-token-main"), "utf-8")).trim()).toBe(token);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("backends starting at the same moment agree on one token", async () => {
        // Without an exclusive create every child sees no file, mints its own token
        // and reports it, so clients would receive conflicting credentials.
        const dir = await mkdtemp(join(tmpdir(), "token-"));
        try {
            expect(await mintConcurrently(dir, join(dir, "tokens"))).toBe(1);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30_000);

    test("backends repairing a corrupt token file at the same moment agree on one token", async () => {
        // Every child finds the invalid file, and each one that replaces it after
        // another already has would report a token the file no longer holds.
        for (let trial = 0; trial < 3; trial++) {
            const dir = await mkdtemp(join(tmpdir(), "token-"));
            const tokenDir = join(dir, "tokens");
            try {
                await mkdir(tokenDir);
                await writeFile(join(tokenDir, "api-token-main"), "not a token");
                expect(await mintConcurrently(dir, tokenDir)).toBe(1);
                expect(await readdir(tokenDir)).toEqual(["api-token-main"]);
            } finally {
                await rm(dir, { recursive: true, force: true });
            }
        }
    }, 60_000);
});

describe("config.apiToken", () => {
    test("importing config writes no token file; reading apiToken mints it", async () => {
        // Every module that imports config (routes, handlers, their tests) would
        // otherwise write into the real config directory: the test preload's HOME
        // override does not reach os.homedir().
        const dir = await mkdtemp(join(tmpdir(), "token-config-"));
        try {
            const importOnly = `await import(${JSON.stringify(CONFIG_MODULE)});`;
            await runWithConfigDir(dir, importOnly);
            expect((await readdir(dir)).filter((name) => name.startsWith("api-token-"))).toEqual(
                [],
            );

            const readToken =
                `const { config } = await import(${JSON.stringify(CONFIG_MODULE)});` +
                `console.log(config.apiToken);`;
            const token = await runWithConfigDir(dir, readToken);
            expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
            expect((await readFile(join(dir, "api-token-main"), "utf-8")).trim()).toBe(token);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30_000);
});
