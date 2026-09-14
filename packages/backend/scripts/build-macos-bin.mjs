import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const supportedArchitectures = ["x64", "arm64"];

function requestedArchitectures(value) {
    if (value === "all") return supportedArchitectures;

    const architecture = value === "current" ? process.arch : value;
    if (!supportedArchitectures.includes(architecture)) {
        throw new Error(`Unsupported macOS architecture: ${architecture}`);
    }
    return [architecture];
}

const packageDirectory = join(import.meta.dir, "..");
const architectures = requestedArchitectures(process.argv[2] ?? "current");

for (const architecture of architectures) {
    const outputPath = join(packageDirectory, "dist", architecture, "taskflow-backend");
    await mkdir(dirname(outputPath), { recursive: true });

    console.log(`Building macOS ${architecture} backend...`);
    const build = Bun.spawn(
        [
            process.execPath,
            "build",
            "src/index.ts",
            "--compile",
            `--target=bun-darwin-${architecture}`,
            `--outfile=${outputPath}`,
        ],
        {
            cwd: packageDirectory,
            stdout: "inherit",
            stderr: "inherit",
        },
    );

    const exitCode = await build.exited;
    if (exitCode !== 0) process.exit(exitCode);
}
