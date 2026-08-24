import { execFileSync } from "child_process";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";

interface DevLaunchInputs {
    env: Readonly<Record<string, string | undefined>>;
    platform: NodeJS.Platform;
    homeDir: string;
    repoRoot: string;
    branch: string;
}

interface DevLaunchConfig {
    devBranch: string;
    configDir: string;
    backendBin: string;
    instanceId: string;
}

function sanitizeBranch(branch: string): string {
    const sanitized = branch
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^[._-]+|[._-]+$/g, "");
    return sanitized || "unknown";
}

function defaultProductionConfigDir(inputs: Pick<DevLaunchInputs, "env" | "platform" | "homeDir">) {
    if (inputs.platform === "win32") {
        return join(inputs.env.APPDATA || join(inputs.homeDir, "AppData", "Roaming"), "taskflow");
    }
    return join(inputs.homeDir, ".config", "taskflow");
}

function resolveDevLaunchConfig(inputs: DevLaunchInputs): DevLaunchConfig {
    const devBranch = inputs.env.TASKFLOW_DEV_BRANCH?.trim() || sanitizeBranch(inputs.branch);
    const rootComponent = sanitizeBranch(devBranch);
    const override = inputs.env.TASKFLOW_CONFIG_DIR;
    let configDir: string;
    if (override !== undefined && override.trim() !== "") {
        if (!isAbsolute(override)) {
            throw new Error("TASKFLOW_CONFIG_DIR must be an absolute path");
        }
        configDir = override;
    } else {
        const productionRoot = defaultProductionConfigDir(inputs);
        configDir = join(
            dirname(productionRoot),
            `${basename(productionRoot)}-tui-dev`,
            rootComponent,
        );
    }

    const backendBin =
        inputs.env.TASKFLOW_BACKEND_BIN ||
        resolve(
            inputs.repoRoot,
            "packages",
            "backend",
            "dist",
            inputs.platform === "win32" ? "taskflow-backend.exe" : "taskflow-backend",
        );

    return {
        devBranch,
        configDir,
        backendBin,
        instanceId: `dev-${devBranch}`,
    };
}

function currentBranch(repoRoot: string): string {
    try {
        return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: repoRoot,
            encoding: "utf-8",
            timeout: 3000,
        }).trim();
    } catch {
        return "unknown";
    }
}

async function main(): Promise<void> {
    const repoRoot = resolve(import.meta.dir, "../../..");
    const launch = resolveDevLaunchConfig({
        env: process.env,
        platform: process.platform,
        homeDir: homedir(),
        repoRoot,
        branch: currentBranch(repoRoot),
    });

    process.env.TASKFLOW_DEV_BRANCH = launch.devBranch;
    process.env.TASKFLOW_CONFIG_DIR = launch.configDir;
    process.env.TASKFLOW_BACKEND_BIN = launch.backendBin;

    process.stdout.write(
        `Taskflow TUI development instance: ${launch.instanceId}\n` +
            `Taskflow TUI config root: ${launch.configDir}\n`,
    );

    const { main: runTui } = await import("./opentui/entry");
    await runTui();
}

if (import.meta.main) {
    void main().catch((error: unknown) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    });
}

export { resolveDevLaunchConfig, sanitizeBranch };
export type { DevLaunchConfig, DevLaunchInputs };
