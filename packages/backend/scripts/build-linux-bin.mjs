import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ripgrepTargets = {
    x64: "x86_64-unknown-linux-musl",
    arm64: "aarch64-unknown-linux-musl",
};

const architecture = process.argv[2] ?? "x64";
const ripgrepTarget = ripgrepTargets[architecture];
if (!ripgrepTarget) {
    throw new Error(`Unsupported Linux architecture: ${architecture}`);
}

const packageDirectory = join(import.meta.dir, "..");
const outputDirectory = join(packageDirectory, "dist", "linux", architecture);
await mkdir(outputDirectory, { recursive: true });

console.log(`Building Linux ${architecture} backend...`);
const build = Bun.spawn(
    [
        process.execPath,
        "build",
        "src/index.ts",
        "--compile",
        `--target=bun-linux-${architecture}`,
        `--outfile=${join(outputDirectory, "taskflow-backend")}`,
    ],
    {
        cwd: packageDirectory,
        stdout: "inherit",
        stderr: "inherit",
    },
);

const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);

// @vscode/ripgrep installs rg only for the host platform, so a release built on
// macOS fetches the Linux rg through the package's own downloader.
const require = createRequire(import.meta.url);
const ripgrepDirectory = dirname(require.resolve("@vscode/ripgrep/package.json"));
const postinstall = await readFile(join(ripgrepDirectory, "lib", "postinstall.js"), "utf8");
const ripgrepVersion = /const VERSION = '([^']+)'/.exec(postinstall)?.[1];
if (!ripgrepVersion) {
    throw new Error("Could not read the ripgrep version from @vscode/ripgrep");
}

console.log(`Downloading ripgrep ${ripgrepVersion} for ${ripgrepTarget}...`);
const download = require(join(ripgrepDirectory, "lib", "download.js"));
await download({
    version: ripgrepVersion,
    target: ripgrepTarget,
    destDir: outputDirectory,
    token: process.env.GITHUB_TOKEN,
    force: true,
});
