import { existsSync } from "node:fs";
import { join } from "node:path";

if (process.platform !== "darwin") {
    throw new Error("Opening the packaged app is only supported on macOS");
}

const outputDirectory = process.arch === "arm64" ? "mac-arm64" : "mac";
const appPath = join(import.meta.dir, "..", "release", outputDirectory, "Taskflow.app");

if (!existsSync(appPath)) {
    throw new Error(`Packaged app not found at ${appPath}. Run \`bun run package\` first.`);
}

const processHandle = Bun.spawn(["open", "--env", "TASKFLOW_DEV=1", appPath], {
    stdout: "inherit",
    stderr: "inherit",
});

process.exit(await processHandle.exited);
