import { parsePortHandshake } from "@taskflow/shared";
import { describe, expect, it } from "bun:test";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    getConfigBaseDir,
    getDefaultShell,
    getDefaultShellEnvVar,
    expandHomePath,
    getEnsurePaths,
    getHomeDir,
    getNullDevice,
    getPathDelimiter,
    isWindows,
    resolveConfigBaseDir,
} from "../../src/services/platform";

describe("platform utilities", () => {
    it("expands a leading ~ against the home directory only", () => {
        const home = join(tmpdir(), "home");
        expect(expandHomePath("~", home)).toBe(home);
        expect(expandHomePath("~/Projects/app", home)).toBe(join(home, "Projects", "app"));
        expect(expandHomePath("/abs/~/x", home)).toBe("/abs/~/x");
        expect(expandHomePath("~other/x", home)).toBe("~other/x");
    });

    it("keeps the existing runtime utility contracts", () => {
        expect(typeof isWindows()).toBe("boolean");
        expect(getHomeDir().length).toBeGreaterThan(0);
        expect(getConfigBaseDir()).toContain("taskflow");
        expect([":", ";"]).toContain(getPathDelimiter());
        expect(["/dev/null", "NUL"]).toContain(getNullDevice());
        expect(getDefaultShell().length).toBeGreaterThan(0);
        const shellEnv = getDefaultShellEnvVar();
        expect(shellEnv === undefined || typeof shellEnv === "string").toBe(true);
        expect(getEnsurePaths().every((path) => typeof path === "string")).toBe(true);
    });
});

describe("resolveConfigBaseDir", () => {
    it("uses the Taskflow override when it is an absolute Unix path", () => {
        expect(
            resolveConfigBaseDir({
                platform: "darwin",
                env: { TASKFLOW_CONFIG_DIR: "/tmp/taskflow-isolated" },
                homeDir: "/Users/test",
            }),
        ).toBe("/tmp/taskflow-isolated");
    });

    it("uses the Taskflow override when it is an absolute Windows path", () => {
        expect(
            resolveConfigBaseDir({
                platform: "win32",
                env: { TASKFLOW_CONFIG_DIR: "D:\\taskflow-isolated" },
                homeDir: "C:\\Users\\test",
            }),
        ).toBe("D:\\taskflow-isolated");
    });

    it("rejects a non-empty relative override", () => {
        expect(() =>
            resolveConfigBaseDir({
                platform: "linux",
                env: { TASKFLOW_CONFIG_DIR: "relative/taskflow" },
                homeDir: "/home/test",
            }),
        ).toThrow("TASKFLOW_CONFIG_DIR must be an absolute path");
    });

    it("keeps the Unix default when the override is absent or empty", () => {
        const inputs = { platform: "linux" as const, homeDir: "/home/test" };
        expect(resolveConfigBaseDir({ ...inputs, env: {} })).toBe("/home/test/.config/taskflow");
        expect(resolveConfigBaseDir({ ...inputs, env: { TASKFLOW_CONFIG_DIR: "" } })).toBe(
            "/home/test/.config/taskflow",
        );
    });

    it("keeps the Windows APPDATA and fallback defaults", () => {
        expect(
            resolveConfigBaseDir({
                platform: "win32",
                env: { APPDATA: "D:\\Roaming" },
                homeDir: "C:\\Users\\test",
            }),
        ).toBe("D:\\Roaming\\taskflow");
        expect(
            resolveConfigBaseDir({
                platform: "win32",
                env: {},
                homeDir: "C:\\Users\\test",
            }),
        ).toBe("C:\\Users\\test\\AppData\\Roaming\\taskflow");
    });

    it("starts and stops an isolated backend without writing the production root", async () => {
        const fixture = await mkdtemp(join(tmpdir(), "taskflow-config-isolation-"));
        const isolated = join(fixture, "isolated");
        const fixtureHome = join(fixture, "home");
        const productionRoot = join(fixtureHome, ".config", "taskflow");
        const portFile = join(fixture, "port");
        const proc = Bun.spawn([process.execPath, "run", "packages/backend/src/index.ts"], {
            cwd: join(import.meta.dir, "../../../.."),
            env: {
                ...process.env,
                HOME: fixtureHome,
                TASKFLOW_CONFIG_DIR: isolated,
                TASKFLOW_DEV_BRANCH: "config-isolation-test",
                TASKFLOW_PORT_FILE: portFile,
            },
            stdout: "pipe",
            stderr: "pipe",
        });
        try {
            const deadline = Date.now() + 10_000;
            let handshake = null;
            while (Date.now() < deadline) {
                if (existsSync(portFile))
                    handshake = parsePortHandshake(await readFile(portFile, "utf-8"));
                if (handshake) break;
                await Bun.sleep(25);
            }
            expect(handshake).not.toBeNull();
            expect(handshake?.port ?? 0).toBeGreaterThan(0);
            const tokenFile = join(isolated, "api-token-dev-config-isolation-test");
            expect(handshake?.token).toBe((await readFile(tokenFile, "utf-8")).trim());
            if (process.platform !== "win32")
                expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
            proc.kill("SIGTERM");
            expect(await proc.exited).toBe(0);
            expect(existsSync(join(isolated, "tasks"))).toBe(true);
            expect(existsSync(join(isolated, "bin", "taskflow-cli"))).toBe(true);
            expect(existsSync(productionRoot)).toBe(false);
        } finally {
            proc.kill("SIGKILL");
            await rm(fixture, { recursive: true, force: true });
        }
    }, 15_000);
});
