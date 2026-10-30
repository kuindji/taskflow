import type { EditorInfo } from "@taskflow/shared";
import { constants } from "fs";
import { access, readdir, stat } from "fs/promises";
import { posix, win32 } from "path";
import { getHomeDir } from "./platform";
import { buildShellPath } from "./shell-path";

export interface EditorResolverDeps {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    homeDir: string;
    path: string;
    which(command: string, path: string): string | null;
    executable(path: string): Promise<boolean>;
    readDirectory(path: string): Promise<string[]>;
    version(command: string): Promise<string | null>;
}

async function probeVersion(command: string): Promise<string | null> {
    try {
        const child = Bun.spawn([command, "--version"], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
        });
        let limited = false;
        let bytes = 0;
        const chunks: Buffer[] = [];
        const readers = [child.stdout.getReader(), child.stderr.getReader()];
        const closeReaders = () => {
            for (const reader of readers) void reader.cancel().catch(() => {});
        };
        const stop = () => {
            limited = true;
            child.kill("SIGKILL");
            // Descendants of a CLI shim can inherit its pipes. Stop reading at
            // the limit even if they keep those pipes open after the shim exits.
            closeReaders();
        };
        const timer = setTimeout(stop, 1000);
        const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
            while (!limited) {
                const { done, value: chunk } = await reader.read();
                if (done) break;
                bytes += chunk.byteLength;
                if (bytes > 8 * 1024) {
                    stop();
                    break;
                }
                chunks.push(Buffer.from(chunk));
            }
        };
        try {
            const [exitCode] = await Promise.all([child.exited, ...readers.map(read)]);
            return !limited && exitCode === 0 ? Buffer.concat(chunks).toString("utf8") : null;
        } finally {
            clearTimeout(timer);
            closeReaders();
            if (child.exitCode === null) child.kill("SIGKILL");
            await child.exited;
        }
    } catch {
        return null;
    }
}

function defaultDeps(): EditorResolverDeps {
    return {
        platform: process.platform,
        env: process.env,
        homeDir: getHomeDir(),
        path: buildShellPath(),
        which: (command, path) => Bun.which(command, { PATH: path }),
        async executable(path) {
            try {
                await access(path, constants.X_OK);
                return (await stat(path)).isFile();
            } catch {
                return false;
            }
        },
        readDirectory: (path) => readdir(path),
        version: probeVersion,
    };
}

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/shared/src/editor.ts
const bundleNames: Record<string, string[]> = {
    vscode: ["Visual Studio Code"],
    cursor: ["Cursor"],
    windsurf: ["Windsurf"],
    zed: ["Zed"],
    sublime: ["Sublime Text"],
    webstorm: ["WebStorm"],
    idea: ["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Ultimate"],
};

export async function resolveEditorCommand(
    editor: Pick<EditorInfo, "id" | "name" | "command">,
    deps: EditorResolverDeps = defaultDeps(),
): Promise<string | null> {
    const path = deps.platform === "win32" ? win32 : posix;
    const names = Object.hasOwn(bundleNames, editor.id) ? bundleNames[editor.id] : undefined;
    const jetbrains = editor.id === "webstorm" || editor.id === "idea";
    const isZed = editor.id === "zed";
    const tried = new Set<string>();
    const check = async (
        candidate: string,
        knownZed = false,
        onPath = false,
    ): Promise<string | null> => {
        if (tried.has(candidate)) return null;
        tried.add(candidate);
        try {
            // Bun.which already checks executability, including Windows PATH shims.
            if (!onPath && !(await deps.executable(candidate))) return null;
            if (isZed && !knownZed) {
                const version = await deps.version(candidate);
                if (!version || !/^Zed\s+\d/i.test(version.trim().split(/\r?\n/, 1)[0])) {
                    return null;
                }
            }
            return candidate;
        } catch {
            return null;
        }
    };
    const fromPath = async (command: string, knownZed = false) => {
        const resolved = deps.which(command, deps.path);
        return resolved ? check(resolved, knownZed, true) : null;
    };
    const directory = async (root: string) => {
        try {
            return await deps.readDirectory(root);
        } catch {
            return [];
        }
    };

    if (!(isZed && (deps.platform === "darwin" || deps.platform === "linux"))) {
        const resolved = await fromPath(editor.command);
        if (resolved) return resolved;
    }
    if (!names) {
        return path.isAbsolute(editor.command) ? check(editor.command) : null;
    }

    if (deps.platform === "darwin") {
        for (const root of [path.join(deps.homeDir, "Applications"), "/Applications"]) {
            const bundles = names.map((name) => `${name}.app`);
            if (jetbrains) {
                const entries = await directory(root);
                const versioned = entries.filter((entry) =>
                    names.some(
                        (name) =>
                            entry.startsWith(`${name} `) &&
                            entry.endsWith(".app") &&
                            /^\d[\d.]*$/.test(entry.slice(name.length + 1, -4)),
                    ),
                );
                bundles.push(
                    ...versioned.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
                );
            }
            for (const bundle of bundles) {
                const contents = path.join(root, bundle, "Contents");
                const suffixes = isZed
                    ? ["MacOS/cli"]
                    : jetbrains
                      ? [`MacOS/${editor.command}`]
                      : editor.id === "sublime"
                        ? ["SharedSupport/bin/subl"]
                        : editor.id === "vscode"
                          ? ["Resources/app/bin/code"]
                          : [`Resources/app/bin/${editor.command}`, "Resources/app/bin/code"];
                for (const suffix of suffixes) {
                    const resolved = await check(path.join(contents, suffix), isZed);
                    if (resolved) return resolved;
                }
            }
        }
        if (jetbrains) {
            const resolved = await check(
                path.join(
                    deps.homeDir,
                    "Library/Application Support/JetBrains/Toolbox/scripts",
                    editor.command,
                ),
            );
            if (resolved) return resolved;
        }
        if (isZed) return fromPath(editor.command);
    } else if (deps.platform === "linux") {
        const dirs = [
            path.join(deps.homeDir, ".local/bin"),
            "/usr/local/bin",
            "/usr/bin",
            "/snap/bin",
        ];
        if (jetbrains) {
            dirs.push(
                path.join(
                    deps.env.XDG_DATA_HOME || path.join(deps.homeDir, ".local/share"),
                    "JetBrains/Toolbox/scripts",
                ),
            );
        }
        for (const command of isZed ? ["zeditor", "zed"] : [editor.command]) {
            if (isZed) {
                const resolved = await fromPath(command, command === "zeditor");
                if (resolved) return resolved;
            }
            for (const dir of dirs) {
                const resolved = await check(path.join(dir, command), command === "zeditor");
                if (resolved) return resolved;
            }
        }
    } else if (deps.platform === "win32") {
        const roots = [
            ...new Set(
                [
                    ...(deps.env.LOCALAPPDATA
                        ? [path.join(deps.env.LOCALAPPDATA, "Programs")]
                        : []),
                    deps.env.ProgramFiles,
                    deps.env["ProgramFiles(x86)"],
                    deps.env.ProgramW6432,
                ].filter((root): root is string => !!root),
            ),
        ];
        for (const root of roots) {
            if (jetbrains) {
                for (const dir of [root, path.join(root, "JetBrains")]) {
                    const entries = (await directory(dir)).filter((entry) =>
                        names.some((name) => entry === name || entry.startsWith(`${name} `)),
                    );
                    for (const entry of entries) {
                        for (const exe of [`${editor.command}64.exe`, `${editor.command}.exe`]) {
                            const resolved = await check(path.join(dir, entry, "bin", exe));
                            if (resolved) return resolved;
                        }
                    }
                }
            } else {
                const native =
                    editor.id === "vscode"
                        ? ["Microsoft VS Code/Code.exe"]
                        : editor.id === "cursor"
                          ? ["Cursor/Cursor.exe"]
                          : editor.id === "windsurf"
                            ? ["Windsurf/Windsurf.exe"]
                            : isZed
                              ? ["Zed/bin/zed.exe", "Zed/zed.exe"]
                              : [];
                for (const suffix of native) {
                    const resolved = await check(path.join(root, suffix), isZed);
                    if (resolved) return resolved;
                }
            }
        }
    }
    return null;
}
