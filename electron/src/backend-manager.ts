import { app } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { constants } from "fs";
import { access, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const UI_DEV_SERVER_URL = process.env.TASKFLOW_UI_URL;

let backendProcess: ChildProcess | null = null;
let backendPort: number | null = null;
let backendPortFile: string | null = null;
let backendStderrBuffer = "";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackendPath(): { binary: string; args: string[] } {
    if (UI_DEV_SERVER_URL) {
        const entry = join(__dirname, "..", "..", "packages", "backend", "src", "index.ts");
        return { binary: "bun", args: ["run", entry] };
    }

    if (app.isPackaged) {
        const binaryName = process.platform === "win32" ? "taskflow-backend.exe" : "taskflow-backend";
        const binary = join(process.resourcesPath, "backend", binaryName);
        return { binary, args: [] };
    }

    const entry = join(__dirname, "..", "..", "packages", "backend", "dist", "index.js");
    return { binary: "bun", args: ["run", entry] };
}

async function waitForBackendPort(portFile: string, timeoutMs: number = 10000): Promise<number> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        try {
            await access(portFile, constants.F_OK);
            const portStr = await readFile(portFile, "utf-8");
            const port = Number.parseInt(portStr.trim(), 10);

            if (Number.isInteger(port) && port > 0) {
                return port;
            }
        } catch {
            // Keep polling until the backend writes a valid port number.
        }

        if (backendProcess && backendProcess.exitCode !== null) {
            throw new Error(`Backend exited before startup (code ${backendProcess.exitCode})`);
        }

        await delay(100);
    }

    throw new Error(`Backend startup timeout after ${timeoutMs}ms`);
}

async function cleanupBackendArtifacts(): Promise<void> {
    if (!backendPortFile) return;

    await rm(backendPortFile, { force: true });
    backendPortFile = null;
}

async function startBackend(devBranch: string | null): Promise<number> {
    backendPortFile = join(tmpdir(), `taskflow-port-${process.pid}-${Date.now()}`);

    const { binary, args } = getBackendPath();

    const { CLAUDECODE: _cc, CLAUDE_CODE_ENTRYPOINT: _cce, ...safeEnv } = process.env;

    backendProcess = spawn(binary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
            ...safeEnv,
            TASKFLOW_PORT_FILE: backendPortFile,
            ...(devBranch ? { TASKFLOW_DEV_BRANCH: devBranch } : {}),
        },
    });

    backendProcess.stdout?.on("data", (data: Buffer) => {
        console.log("[backend]", data.toString().trim());
    });

    backendProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString().trim();
        console.error("[backend error]", text);
        backendStderrBuffer += text + "\n";
    });

    return Promise.race([
        waitForBackendPort(backendPortFile),
        new Promise<never>((_, reject) => {
            backendProcess?.once("error", reject);
        }),
        new Promise<never>((_, reject) => {
            backendProcess?.once("exit", (code) => {
                reject(new Error(`Backend exited before startup (code ${code ?? "unknown"})`));
            });
        }),
    ]);
}

function getBackendPort(): number | null {
    return backendPort;
}

function setBackendPort(port: number): void {
    backendPort = port;
}

function getBackendStderrBuffer(): string {
    return backendStderrBuffer;
}

function killBackendProcess(): void {
    if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
    }
}

function getUIDevServerURL(): string | undefined {
    return UI_DEV_SERVER_URL;
}

function getUIPath(): string {
    if (app.isPackaged) {
        return join(process.resourcesPath, "ui", "index.html");
    }
    return join(__dirname, "..", "..", "packages", "ui", "dist", "index.html");
}

export {
    startBackend,
    cleanupBackendArtifacts,
    getBackendPort,
    setBackendPort,
    getBackendStderrBuffer,
    killBackendProcess,
    getUIDevServerURL,
    getUIPath,
};
