// pty-bridge.mjs — Node.js child process that wraps node-pty for Windows.
// Communicates with the Bun parent via NDJSON over stdin/stdout.
// Data payloads are base64-encoded to safely transport binary/control chars.

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve a bare command name to a full executable path on Windows.
 * node-pty uses CreateProcess which doesn't search PATH for extensionless names.
 */
function resolveCommand(command, env) {
    // Already a full path or has extension
    if (command.includes("\\") || command.includes("/") || command.includes(".")) {
        return command;
    }
    const pathVar = env?.PATH || env?.Path || env?.path || process.env.PATH || "";
    const extensions = [".exe", ".cmd", ".bat", ".com"];
    for (const dir of pathVar.split(";")) {
        if (!dir) continue;
        for (const ext of extensions) {
            const candidate = join(dir, command + ext);
            if (existsSync(candidate)) return candidate;
        }
    }
    // Fallback: append .exe and hope CreateProcess finds it
    return command + ".exe";
}

let nodePty;
try {
    nodePty = require("node-pty");
} catch (e) {
    send({ type: "error", message: `Failed to load node-pty: ${e.message}` });
    process.exit(1);
}

let pty = null;

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
    let msg;
    try {
        msg = JSON.parse(line);
    } catch {
        return; // ignore malformed
    }

    switch (msg.type) {
        case "spawn": {
            try {
                const resolvedFile = resolveCommand(msg.file, msg.env);
                pty = nodePty.spawn(resolvedFile, msg.args ?? [], {
                    name: "xterm-256color",
                    cols: msg.cols ?? 80,
                    rows: msg.rows ?? 24,
                    cwd: msg.cwd,
                    env: msg.env,
                });

                send({ type: "ready", pid: pty.pid });

                pty.onData((data) => {
                    send({ type: "data", data: Buffer.from(data).toString("base64") });
                });

                pty.onExit(({ exitCode }) => {
                    send({ type: "exit", exitCode: exitCode ?? 1 });
                    setTimeout(() => process.exit(0), 100);
                });
            } catch (e) {
                send({ type: "error", message: `Spawn failed: ${e.message}` });
                process.exit(1);
            }
            break;
        }
        case "write":
            pty?.write(msg.data);
            break;
        case "resize":
            try {
                pty?.resize(msg.cols, msg.rows);
            } catch {
                /* ignore resize errors */
            }
            break;
        case "kill":
            pty?.kill();
            break;
    }
});

// Parent died — clean up
rl.on("close", () => {
    try {
        pty?.kill();
    } catch {
        /* ignore */
    }
    process.exit(0);
});

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}
