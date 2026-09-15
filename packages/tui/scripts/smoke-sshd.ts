/**
 * Disposable sshd for the Stage 4 remote smoke. Everything it creates lives
 * under the root given on the command line, so deleting that root removes it:
 *
 *   bun packages/tui/scripts/smoke-sshd.ts <root>
 *
 * It listens on 127.0.0.1:2222, accepts only the generated client key, prints
 * that key's path as `client-key: <path>`, and stops sshd when it exits.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SSHD = "/usr/sbin/sshd";
const SSH_KEYGEN = "/usr/bin/ssh-keygen";

const rootArg = process.argv[2];
if (rootArg === undefined || rootArg === "") {
    process.stderr.write("usage: bun packages/tui/scripts/smoke-sshd.ts <root>\n");
    process.exit(2);
}

// sshd refuses a relative config path and resolves relative key paths against
// its own working directory, so every path it sees is absolute.
const root = resolve(rootArg);
const etcDir = join(root, "etc");
const sshDir = join(root, "ssh");
const hostKey = join(etcDir, "ssh_host_ed25519_key");
const clientKey = join(sshDir, "client_ed25519");
const authorizedKeys = join(sshDir, "authorized_keys");
const configFile = join(etcDir, "sshd_config");
const pidFile = join(etcDir, "sshd.pid");

for (const dir of [join(root, "home"), etcDir, sshDir]) mkdirSync(dir, { recursive: true });

/** Generates an ed25519 key pair once; a rerun on the same root reuses it. */
function ensureKey(path: string, comment: string): void {
    if (!existsSync(path)) {
        const result = spawnSync(
            SSH_KEYGEN,
            ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", path],
            { stdio: ["ignore", "inherit", "inherit"] },
        );
        if (result.status !== 0) {
            process.stderr.write(`ssh-keygen failed for ${path}\n`);
            process.exit(1);
        }
    }
    chmodSync(path, 0o600);
}

ensureKey(hostKey, "taskflow-smoke-host");
ensureKey(clientKey, "taskflow-smoke-client");

writeFileSync(authorizedKeys, readFileSync(`${clientKey}.pub`), { mode: 0o600 });
writeFileSync(
    configFile,
    [
        "Port 2222",
        "ListenAddress 127.0.0.1",
        `HostKey ${hostKey}`,
        `AuthorizedKeysFile ${authorizedKeys}`,
        "PasswordAuthentication no",
        "UsePAM no",
        "StrictModes no",
        `PidFile ${pidFile}`,
        "",
    ].join("\n"),
    { mode: 0o600 },
);

const sshd = spawn(SSHD, ["-D", "-f", configFile], { stdio: ["ignore", "inherit", "inherit"] });

function stopSshd(): void {
    if (sshd.exitCode === null && sshd.signalCode === null) sshd.kill("SIGTERM");
}

process.on("exit", stopSshd);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
        stopSshd();
        process.exit(0);
    });
}

sshd.on("error", (error) => {
    process.stderr.write(`could not start sshd: ${error.message}\n`);
    process.exit(1);
});
sshd.on("exit", (code, signal) => {
    process.stderr.write(`sshd exited (${signal ?? String(code)})\n`);
    process.exit(code ?? 0);
});

process.stdout.write(`client-key: ${clientKey}\n`);
