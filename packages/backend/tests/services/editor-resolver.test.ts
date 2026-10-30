import { describe, expect, it } from "bun:test";
import { win32, join } from "path";
import { mkdtemp, mkdir, writeFile, chmod, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import type { EditorInfo } from "@taskflow/shared";
import { resolveEditorCommand, type EditorResolverDeps } from "../../src/services/editor-resolver";

const code = { id: "vscode", name: "VS Code", command: "code" };
const idea = { id: "idea", name: "IntelliJ IDEA", command: "idea" };
const webstorm = { id: "webstorm", name: "WebStorm", command: "webstorm" };
const zed = { id: "zed", name: "Zed", command: "zed" };

function fixture(platform: NodeJS.Platform = "darwin") {
    const commands = new Map<string, string>();
    const files = new Set<string>();
    const directories = new Map<string, string[]>();
    const versions = new Map<string, string | null>();
    const checked: string[] = [];
    const probed: string[] = [];
    const deps: EditorResolverDeps = {
        platform,
        env: {},
        homeDir: platform === "win32" ? "C:\\Users\\tester" : "/home/tester",
        path: "shell-path",
        which(command, path) {
            expect(path).toBe("shell-path");
            return commands.get(command) ?? null;
        },
        async executable(path) {
            checked.push(path);
            return files.has(path);
        },
        async readDirectory(path) {
            const entries = directories.get(path);
            if (!entries) throw new Error("unreadable directory");
            return entries;
        },
        async version(command) {
            probed.push(command);
            return versions.get(command) ?? null;
        },
    };
    return { deps, commands, files, directories, versions, checked, probed };
}

describe("resolveEditorCommand", () => {
    it("PATH wins for an ordinary editor", async () => {
        const f = fixture();
        f.commands.set("code", "/shims/code");
        f.files.add("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
        expect(await resolveEditorCommand(code, f.deps)).toBe("/shims/code");
        expect(f.checked).toEqual([]);
    });

    it("a macOS app bundle works without a PATH shim", async () => {
        for (const [editor, executable] of [
            [code, "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"],
            [
                { id: "cursor", name: "Cursor", command: "cursor" },
                "/Applications/Cursor.app/Contents/Resources/app/bin/code",
            ],
            [
                { id: "windsurf", name: "Windsurf", command: "windsurf" },
                "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
            ],
        ] satisfies [Pick<EditorInfo, "id" | "name" | "command">, string][]) {
            const f = fixture();
            f.files.add(executable);
            expect(await resolveEditorCommand(editor, f.deps)).toBe(executable);
        }
    });

    it("home Applications precedes system Applications", async () => {
        const f = fixture();
        const home =
            "/home/tester/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
        f.files.add(home);
        f.files.add("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code");
        expect(await resolveEditorCommand(code, f.deps)).toBe(home);
    });

    it("versioned JetBrains bundles match only numeric versions", async () => {
        const f = fixture();
        f.directories.set("/Applications", [
            "WebStorm 2025.9.app",
            "WebStorm Preview.app",
            "WebStorm 2025.10.app",
            "WebStorm 2025.11-beta.app",
        ]);
        for (const bundle of f.directories.get("/Applications")!) {
            f.files.add(`/Applications/${bundle}/Contents/MacOS/webstorm`);
        }
        expect(await resolveEditorCommand(webstorm, f.deps)).toBe(
            "/Applications/WebStorm 2025.10.app/Contents/MacOS/webstorm",
        );
        f.files.add("/Applications/WebStorm.app/Contents/MacOS/webstorm");
        expect(await resolveEditorCommand(webstorm, f.deps)).toBe(
            "/Applications/WebStorm.app/Contents/MacOS/webstorm",
        );
        f.files.clear();
        f.files.add("/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea");
        expect(await resolveEditorCommand(idea, f.deps)).toBe(
            "/Applications/IntelliJ IDEA CE.app/Contents/MacOS/idea",
        );
    });

    it("stable Code does not select Insiders", async () => {
        const f = fixture();
        f.directories.set("/Applications", ["Visual Studio Code - Insiders.app"]);
        f.files.add(
            "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
        );
        expect(await resolveEditorCommand(code, f.deps)).toBeNull();
    });

    it("macOS and Linux Toolbox scripts are found", async () => {
        for (const [platform, dataHome, executable] of [
            [
                "darwin",
                undefined,
                "/home/tester/Library/Application Support/JetBrains/Toolbox/scripts/idea",
            ],
            ["linux", undefined, "/home/tester/.local/share/JetBrains/Toolbox/scripts/idea"],
            ["linux", "/data", "/data/JetBrains/Toolbox/scripts/idea"],
        ] as const) {
            const f = fixture(platform);
            f.deps.env.XDG_DATA_HOME = dataHome;
            f.files.add(executable);
            expect(await resolveEditorCommand(idea, f.deps)).toBe(executable);
        }
    });

    it("Windows JetBrains native executables are found", async () => {
        const f = fixture("win32");
        f.deps.env.ProgramFiles = "C:\\Program Files";
        f.deps.env.ProgramW6432 = "C:\\Program Files";
        f.directories.set("C:\\Program Files\\JetBrains", [
            "WebStormBackup",
            "WebStorm 2026.1",
            "WebStorm",
        ]);
        const executable = win32.join(
            "C:\\Program Files",
            "JetBrains",
            "WebStorm",
            "bin",
            "webstorm64.exe",
        );
        f.files.add(executable);
        f.files.add(
            win32.join("C:\\Program Files", "JetBrains", "WebStorm", "bin", "webstorm.exe"),
        );
        f.files.add(
            win32.join("C:\\Program Files", "JetBrains", "WebStormBackup", "bin", "webstorm64.exe"),
        );
        expect(await resolveEditorCommand(webstorm, f.deps)).toBe(executable);
        expect(f.checked.filter((path) => path === executable)).toHaveLength(1);
        f.files.clear();
        const versioned = "C:\\Program Files\\JetBrains\\WebStorm 2026.1\\bin\\webstorm.exe";
        f.files.add(versioned);
        expect(await resolveEditorCommand(webstorm, f.deps)).toBe(versioned);
    });

    it("Windows never adds a .cmd candidate (Toolbox scripts and resources/app/bin)", async () => {
        const f = fixture("win32");
        f.deps.env.LOCALAPPDATA = "C:\\Users\\tester\\AppData\\Local";
        f.deps.env.ProgramFiles = "C:\\Program Files";
        f.files.add("C:\\Program Files\\Microsoft VS Code\\resources\\app\\bin\\code.cmd");
        f.files.add("C:\\Users\\tester\\AppData\\Local\\JetBrains\\Toolbox\\scripts\\idea.cmd");
        expect(await resolveEditorCommand(code, f.deps)).toBeNull();
        expect(await resolveEditorCommand(idea, f.deps)).toBeNull();
        expect(f.checked.some((path) => path.endsWith(".cmd"))).toBe(false);
        const native = "C:\\Program Files\\Microsoft VS Code\\Code.exe";
        f.files.add(native);
        expect(await resolveEditorCommand(code, f.deps)).toBe(native);
    });

    it("Windows PATH lookup behaves as today", async () => {
        const f = fixture("win32");
        f.commands.set("code", "C:\\shims\\code.cmd");
        expect(await resolveEditorCommand(code, f.deps)).toBe("C:\\shims\\code.cmd");
    });

    it("Linux zeditor is preferred to zed", async () => {
        const f = fixture("linux");
        f.commands.set("zed", "/usr/bin/zed");
        f.versions.set("/usr/bin/zed", "Zed 1.0");
        f.files.add("/snap/bin/zeditor");
        expect(await resolveEditorCommand(zed, f.deps)).toBe("/snap/bin/zeditor");
        expect(f.probed).toEqual([]);
        f.commands.set("zeditor", "/shims/zeditor");
        expect(await resolveEditorCommand(zed, f.deps)).toBe("/shims/zeditor");
    });

    it("Zed bundle is preferred to an OpenZFS PATH command", async () => {
        const f = fixture();
        f.commands.set("zed", "/opt/bin/zed");
        f.versions.set("/opt/bin/zed", "ZFS Event Daemon 2.3");
        f.files.add("/Applications/Zed.app/Contents/MacOS/cli");
        expect(await resolveEditorCommand(zed, f.deps)).toBe(
            "/Applications/Zed.app/Contents/MacOS/cli",
        );
        expect(f.probed).toEqual([]);
    });

    it("OpenZFS zed is never returned", async () => {
        const f = fixture("linux");
        f.commands.set("zed", "/usr/bin/zed");
        f.files.add("/usr/bin/zed");
        f.versions.set("/usr/bin/zed", "zed-2.3.0\nZed 1.0");
        expect(await resolveEditorCommand(zed, f.deps)).toBeNull();
    });

    it("an unverified zed timeout is unavailable", async () => {
        const f = fixture("linux");
        f.commands.set("zed", "/usr/bin/zed");
        f.versions.set("/usr/bin/zed", null);
        expect(await resolveEditorCommand(zed, f.deps)).toBeNull();
    });

    it("a verified Zed PATH executable is returned", async () => {
        for (const platform of ["darwin", "linux", "win32"] as const) {
            const f = fixture(platform);
            const executable = platform === "win32" ? "C:\\bin\\zed.exe" : "/bin/zed";
            f.commands.set("zed", executable);
            f.versions.set(executable, "  zED 0.200.1\nmore output");
            expect(await resolveEditorCommand(zed, f.deps)).toBe(executable);
            expect(f.probed).toEqual([executable]);
        }
    });

    it("Sublime uses its SharedSupport executable", async () => {
        const f = fixture();
        const executable = "/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl";
        f.files.add(executable);
        expect(
            await resolveEditorCommand(
                { id: "sublime", name: "Sublime Text", command: "subl" },
                f.deps,
            ),
        ).toBe(executable);
    });

    it("unreadable directories do not abort detection", async () => {
        const f = fixture();
        f.deps.executable = async (path) => {
            if (path.startsWith("/home/tester/")) throw new Error("EACCES");
            return path === "/Applications/WebStorm.app/Contents/MacOS/webstorm";
        };
        expect(await resolveEditorCommand(webstorm, f.deps)).toBe(
            "/Applications/WebStorm.app/Contents/MacOS/webstorm",
        );
    });

    it("unknown editor commands use PATH without bundle guessing", async () => {
        const f = fixture();
        const custom = { id: "custom", name: "Custom", command: "my-editor" };
        f.commands.set("my-editor", "/bin/my-editor");
        expect(await resolveEditorCommand(custom, f.deps)).toBe("/bin/my-editor");
        f.commands.clear();
        f.files.add("/Applications/Custom.app/Contents/Resources/app/bin/my-editor");
        expect(await resolveEditorCommand(custom, f.deps)).toBeNull();
        const absolute = { ...custom, command: "/custom/editor" };
        f.files.add(absolute.command);
        expect(await resolveEditorCommand(absolute, f.deps)).toBe(absolute.command);
        expect(
            await resolveEditorCommand({ ...custom, command: "code --wait" }, f.deps),
        ).toBeNull();
        expect(
            await resolveEditorCommand(
                { id: "constructor", name: "constructor", command: "constructor" },
                f.deps,
            ),
        ).toBeNull();
    });
});

// Run the real default probe in a separate process so its injected platform and
// isolated config/bin never affect this suite's process or the user's editors.
it.skipIf(process.platform === "win32")(
    "the real Zed probe deadline closes pipes inherited by a shim child",
    async () => {
        const root = await mkdtemp(join(tmpdir(), "taskflow-editor-probe-"));
        const descendantFile = join(root, "descendant");
        try {
            await mkdir(join(root, "bin"));
            const shim = join(root, "bin", "zed");
            await writeFile(
                shim,
                `#!/bin/sh\n/bin/sleep 4 &\necho $! > "${descendantFile}"\nwait\n`,
            );
            await chmod(shim, 0o755);
            const driver = join(root, "driver.ts");
            await writeFile(
                driver,
                `
            import { resolveEditorCommand } from ${JSON.stringify(new URL("../../src/services/editor-resolver.ts", import.meta.url).href)};
            import { buildShellPath } from ${JSON.stringify(new URL("../../src/services/shell-path.ts", import.meta.url).href)};
            // Use a PATH-only platform so installed Linux zeditor or macOS
            // bundles cannot bypass the shim whose default probe we exercise.
            Object.defineProperty(process, "platform", { value: "freebsd" });
            buildShellPath();
            const started = performance.now();
            await resolveEditorCommand({ id: "zed", name: "Zed", command: "zed" });
            console.log(JSON.stringify({ elapsed: performance.now() - started }));
        `,
            );
            const child = Bun.spawn([process.execPath, driver], {
                env: { ...process.env, TASKFLOW_CONFIG_DIR: root },
                stdout: "pipe",
                stderr: "pipe",
            });
            const [exitCode, stdout, stderr] = await Promise.all([
                child.exited,
                new Response(child.stdout).text(),
                new Response(child.stderr).text(),
            ]);
            expect(stderr).toBe("");
            expect(exitCode).toBe(0);
            const result = JSON.parse(stdout) as { elapsed: number };
            expect(result.elapsed).toBeLessThan(2500);
        } finally {
            try {
                process.kill(Number((await readFile(descendantFile, "utf8")).trim()), "SIGKILL");
            } catch {
                /* Already exited. */
            }
            await rm(root, { recursive: true, force: true });
        }
    },
    10_000,
);
