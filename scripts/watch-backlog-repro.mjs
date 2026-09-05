// scripts/watch-backlog-repro.mjs
// Manual check for the 2026-09-05 backend hang. A child process creates N
// files under the watched root while this thread is deliberately blocked, so
// a backlog of filesystem events accumulates. After the block, the script
// reports how long the event loop stayed starved while Bun dispatched the
// backlog and how much memory that left behind. Node caps a dispatch pass;
// Bun drains the whole backlog, which is why the backend keeps its per-event
// work to a synchronous ignore check and a Set insert.
//
// Usage: bun scripts/watch-backlog-repro.mjs /tmp/watch-repro [files=100000] [blockMs=20000]
import { watch, mkdirSync, rmSync } from "fs";
import { spawn } from "child_process";
import { join } from "path";

const ROOT = process.argv[2];
const N = Number(process.argv[3] ?? 100000);
const BLOCK_MS = Number(process.argv[4] ?? 20000);
if (!ROOT) throw new Error("usage: watch-backlog-repro <root> [files] [blockMs]");

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(ROOT, "src"), { recursive: true });

let events = 0;
const watcher = watch(ROOT, { recursive: true }, () => events++);
const rss = () => (process.memoryUsage().rss / 1e6).toFixed(0);
const t0 = Date.now();
const T = () => ((Date.now() - t0) / 1000).toFixed(2) + "s";
const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`[${rt}] watching ${ROOT}; N=${N} block=${BLOCK_MS}ms rss=${rss()}MB`);

const dir = join(ROOT, "src", "burst");
const script = `mkdir -p '${dir}' && cd '${dir}' && for i in $(seq 1 ${N}); do : > f$i; done && echo burst-done`;
const child = spawn("bash", ["-c", script], { stdio: "inherit" });

await new Promise((resolve) => setTimeout(resolve, 500));
console.log(`[${rt}] ${T()} blocking the JS thread for ${BLOCK_MS}ms`);
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
const unblockedAt = Date.now();
console.log(`[${rt}] ${T()} unblocked; events so far=${events} rss=${rss()}MB`);

setTimeout(() => {
    console.log(`[${rt}] ${T()} first timer ran ${Date.now() - unblockedAt}ms after unblock; events=${events} rss=${rss()}MB`);
}, 0);

let ticks = 0;
const interval = setInterval(() => {
    ticks++;
    console.log(`[${rt}] ${T()} events=${events} rss=${rss()}MB`);
    if (ticks >= 5) {
        clearInterval(interval);
        watcher.close();
        child.kill();
        rmSync(ROOT, { recursive: true, force: true });
        process.exit(0);
    }
}, 2000);
