import { execFileSync } from "child_process";

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

console.log(`Electron build complete (branch: ${branch})`);
