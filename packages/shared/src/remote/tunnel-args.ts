import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendRecord, TunnelFailure } from "../types/backend";

/**
 * The app's own trust store. Host-key approval is the one security decision
 * this app makes for the user, so the file it is written to and the name it is
 * written under must both be ours. `~/.ssh/config` may still supply ProxyJump,
 * IdentityFile and the rest — only host-key identity is taken out of its hands.
 */
export const KNOWN_HOSTS_FILE = join(homedir(), ".taskflow", "known_hosts");

/**
 * What a key is filed under. Independent of any HostKeyAlias in user config,
 * and keyed by how the machine is *reached*, not by who it is: a host key
 * belongs to a host. Keying it by uid would change every record's alias at its
 * first handshake (provisional key → uid), so the line approved moments
 * earlier would never be looked at again and the trust dialog would come back
 * on the next launch for every machine.
 *
 * The host is percent-encoded where ssh's option parser would choke on it:
 * whitespace splits a `-o` value ("extra arguments at end of line") and a
 * stray quote is "invalid quotes", either of which fails the whole command
 * before ssh can report the host name itself as invalid. The alias is also the
 * first field of the known_hosts line `trustHostKey` writes, where `*` and `?`
 * are wildcards, `!` negates and `,` separates patterns, so those are encoded
 * as well: a line filed under `taskflow-*-22` would vouch for every machine on
 * port 22. `%` is encoded too, so no two hosts share an alias. Every encoded
 * character is ASCII, so each becomes exactly two hex digits.
 */
export function hostKeyAlias(record: BackendRecord): string {
    const host = Array.from(record.host, encodeAliasChar).join("");
    return `taskflow-${host}-${record.sshPort}`;
}

function encodeAliasChar(char: string): string {
    const code = char.charCodeAt(0);
    const unsafe = code < 0x20 || code === 0x7f || ` "'\\%*?!,`.includes(char);
    return unsafe ? `%${code.toString(16).padStart(2, "0")}` : char;
}

/**
 * `-L` forwards a local port to loopback on the remote host, which is the only
 * address the backend binds. The remote end is `localhost`, not `127.0.0.1`:
 * `TASKFLOW_HOST` may pin that backend to `::1` (`utils/backend-host.ts`), and
 * sshd tries each address the name resolves to until one accepts. The *local*
 * bind address is spelled out too:
 * without it ssh follows GatewayPorts, so a user who set `GatewayPorts yes`
 * would expose the remote backend on their own LAN through this client.
 * BatchMode keeps ssh from ever blocking on a prompt — it exits and we read
 * stderr instead. ExitOnForwardFailure turns a failed local bind into an exit
 * rather than a tunnel that is up but useless.
 *
 * **`StrictHostKeyChecking=yes` is not optional and is not a duplicate of
 * BatchMode.** Everything this feature does about host keys — the fingerprint
 * dialog, `trustHostKey`, the `unknown-host-key` classification — is downstream
 * of ssh *refusing* to connect to a host it has no key for, and `~/.ssh/config`
 * can switch that refusal off for every host at once. `Host *` with
 * `StrictHostKeyChecking accept-new` is a common dotfile line, and `no` is
 * common in corporate configs. With an `accept-new` config and no override in
 * the argv, OpenSSH 10.3p1 printed `Warning: Permanently added ... to the list
 * of known hosts.` and went straight on to authentication, so
 * `classifyTunnelFailure` never returns `unknown-host-key` and the dialog never
 * opens. Anyone on the LAN can advertise an entry pointing at a machine they
 * control, so this refusal is what the beacon threat model rests on.
 *
 * The three options after it pin *where* the key is looked up. A `Host` block
 * with its own `UserKnownHostsFile` or `HostKeyAlias` would otherwise make ssh
 * check a different file under a different name from the one `trustHostKey`
 * wrote: the user approves a fingerprint and the connection fails anyway, or
 * the anchor actually used is not the one approved. Command-line `-o` values
 * take precedence over the config file.
 *
 * Only host-key identity is forced. The user's config is otherwise left in
 * charge — `ProxyJump`, `IdentityFile` and per-host `User` are legitimate and a
 * blanket `-F /dev/null` would break them.
 *
 * `-l user -- host` rather than `user@host`, because `user@host` is one string
 * and getopt reads a leading `-` in it as options: a record with user `-bad`
 * makes ssh dump its usage and exit, which `classifyTunnelFailure` can only
 * report as "unknown". With `-l` and `--`, the same input gives
 * `remote username contains invalid characters` — a sentence naming the field.
 * `host` on a discovered record is a beacon source address, so this is the
 * layer that has to be safe.
 */
export function buildTunnelArgs(
    record: BackendRecord,
    localPort: number,
    backendPort: number,
): string[] {
    return [
        "-N",
        "-L",
        `127.0.0.1:${localPort}:localhost:${backendPort}`,
        "-p",
        String(record.sshPort),
        ...connectionOptions(record),
        "-o",
        "ExitOnForwardFailure=yes",
        "-o",
        "ServerAliveInterval=15",
        "-o",
        "ServerAliveCountMax=3",
        "-l",
        record.user,
        "--",
        record.host,
    ];
}

/** `StrictHostKeyChecking=yes` and the three options that pin where the key is
 *  looked up. Every ssh invocation that connects to a record passes these; see
 *  `buildTunnelArgs` for why each one is there. */
export function hostKeyOptions(record: BackendRecord): string[] {
    return hostKeyLookupOptions(record, "yes", KNOWN_HOSTS_FILE);
}

function hostKeyLookupOptions(
    record: BackendRecord,
    checking: "yes" | "accept-new",
    knownHostsFile: string,
): string[] {
    return [
        "-o",
        `StrictHostKeyChecking=${checking}`,
        "-o",
        `UserKnownHostsFile=${knownHostsFile}`,
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        "-o",
        `HostKeyAlias=${hostKeyAlias(record)}`,
    ];
}

function connectionOptions(
    record: BackendRecord,
    hostKey: string[] = hostKeyOptions(record),
): string[] {
    return [
        "-o",
        "BatchMode=yes",
        ...hostKey,
        // Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/ssh/src/tunnel.ts
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "ControlPersist=no",
    ];
}

/**
 * `cat` of one file in the remote's config dir. Single-quoted so the remote
 * shell treats it as one literal word, and `~` rather than `$HOME` so expansion
 * still happens outside the quotes; callers build `fileName` from a validated
 * instance id. The host-key options matter more here than for the tunnel: a
 * manual connect's first ssh call is this read, so it is the one that produces
 * the host-key failure the trust dialog reacts to.
 */
export function buildRemoteReadArgs(record: BackendRecord, fileName: string): string[] {
    return [
        "-p",
        String(record.sshPort),
        ...connectionOptions(record),
        "-l",
        record.user,
        "--",
        record.host,
        `cat ~/.config/taskflow/'${fileName}'`,
    ];
}

/** The first field of a `known_hosts` line ssh will look up. `HostKeyAlias`
 *  replaces both the host and the port in that lookup, so there is no bracket
 *  form to produce. */
export function knownHostsKey(record: BackendRecord): string {
    return hostKeyAlias(record);
}

/**
 * Collects the host key with `ssh` itself, not `ssh-keyscan`. `ssh-keyscan`
 * reads no ssh config, so a record whose host is a `Host` alias (`HostName`,
 * `Port`) or sits behind `ProxyJump` scans nothing, and the trust dialog can
 * never be approved even though the connection itself reaches the host.
 *
 * Same route and options as every other call, except that the key is accepted
 * into `scanFile` — a scratch file, never the trust store — under the same
 * alias. ssh writes it there during key exchange, before authentication, so
 * the call's exit status does not matter. `PreferredAuthentications=none`
 * offers the destination no credential at all, so an agent that confirms each
 * use or a hardware key does not prompt for a scan (a `ProxyJump` hop still
 * authenticates: command-line `-o` values apply to the destination only).
 * `true`, `-n` and `-T` cover a server that accepts `none` anyway.
 */
export function buildHostKeyScanArgs(record: BackendRecord, scanFile: string): string[] {
    return [
        "-n",
        "-T",
        "-p",
        String(record.sshPort),
        ...connectionOptions(record, hostKeyLookupOptions(record, "accept-new", scanFile)),
        "-o",
        "PreferredAuthentications=none",
        "-o",
        "ConnectTimeout=5",
        "-l",
        record.user,
        "--",
        record.host,
        "true",
    ];
}

export function classifyTunnelFailure(stderr: string, exitCode: number | null): TunnelFailure {
    const failure = (kind: TunnelFailure["kind"], message: string): TunnelFailure => ({
        kind,
        message,
        stderr,
    });

    if (stderr.includes("ENOENT")) {
        return failure("no-ssh-binary", "OpenSSH client not found on this machine.");
    }
    if (stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
        return failure(
            "changed-host-key",
            "The host key changed. Resolve this yourself before connecting again.",
        );
    }
    if (stderr.includes("Host key verification failed")) {
        return failure("unknown-host-key", "This host has not been trusted yet.");
    }
    if (
        stderr.includes("Address already in use") ||
        stderr.includes("Could not request local forwarding")
    ) {
        return failure("local-bind-failed", "The local port was taken.");
    }
    if (stderr.includes("Permission denied")) {
        return failure(
            "auth-refused",
            "SSH refused the connection. Run `ssh <host>` once in a terminal to check your key.",
        );
    }
    // What `-l user -- host` turns a leading dash into. Without those two
    // separators ssh prints its usage instead, which matches nothing here and
    // reaches the user as "SSH exited with code 255."
    if (stderr.includes("contains invalid characters")) {
        return failure(
            "bad-destination",
            stderr.includes("username")
                ? "That SSH user name is not valid. Edit it in Manage backends."
                : "That host name is not valid. Edit it in Manage backends.",
        );
    }
    if (
        stderr.includes("Could not resolve") ||
        stderr.includes("Connection refused") ||
        stderr.includes("Connection timed out") ||
        stderr.includes("Operation timed out") ||
        stderr.includes("No route to host") ||
        stderr.includes("Network is unreachable")
    ) {
        return failure("no-route", "That host is not reachable from here.");
    }
    return failure("unknown", `SSH exited with code ${exitCode ?? "unknown"}.`);
}
