import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";

let branch: string;
try {
    branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        encoding: "utf-8",
        timeout: 3000,
    })
        .trim()
        .replace(/\//g, "-");
} catch {
    branch = "unknown";
}

function commandExists(command: string): boolean {
    try {
        execFileSync("which", [command], {
            stdio: "ignore",
            timeout: 3000,
        });
        return true;
    } catch {
        return false;
    }
}

function buildMenuBarIconPng(size: 18 | 36, outFile: string) {
    const source = join(import.meta.dir, "build", "menubar-icon.svg");

    if (commandExists("rsvg-convert")) {
        execFileSync(
            "rsvg-convert",
            ["--width", String(size), "--height", String(size), source, "--output", outFile],
            { stdio: "pipe", timeout: 10000 },
        );
        return;
    }

    if (process.platform === "darwin") {
        execFileSync(
            "sips",
            [
                "-s",
                "format",
                "png",
                "--resampleHeightWidth",
                String(size),
                String(size),
                source,
                "--out",
                outFile,
            ],
            { stdio: "pipe", timeout: 10000 },
        );
        return;
    }

    throw new Error(
        "Failed to build menu bar icon assets: install rsvg-convert or build on macOS with sips available.",
    );
}

const mainResult = await Bun.build({
    entrypoints: ["src/main.ts"],
    outdir: "dist",
    target: "node",
    format: "cjs",
    external: ["electron", "electron-updater"],
    define: {
        BUILD_GIT_BRANCH: JSON.stringify(branch),
    },
});

if (!mainResult.success) {
    console.error("Failed to build main.ts:");
    for (const log of mainResult.logs) {
        console.error(log);
    }
    process.exit(1);
}

const preloadResult = await Bun.build({
    entrypoints: ["src/preload.ts"],
    outdir: "dist",
    target: "node",
    format: "cjs",
    external: ["electron"],
});

if (!preloadResult.success) {
    console.error("Failed to build preload.ts:");
    for (const log of preloadResult.logs) {
        console.error(log);
    }
    process.exit(1);
}

mkdirSync("dist", { recursive: true });
buildMenuBarIconPng(18, join(import.meta.dir, "dist", "menubar-icon.png"));
buildMenuBarIconPng(36, join(import.meta.dir, "dist", "menubar-icon@2x.png"));

console.log(`Electron build complete (branch: ${branch})`);
