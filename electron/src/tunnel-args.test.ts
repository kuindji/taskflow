import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BackendRecord } from "@taskflow/shared";
import {
    buildKeyscanArgs,
    buildTunnelArgs,
    classifyTunnelFailure,
    hostKeyAlias,
    KNOWN_HOSTS_FILE,
    knownHostsKey,
} from "./tunnel-args";

const record: BackendRecord = {
    id: "192.168.1.20:main",
    backendUid: null,
    host: "192.168.1.20",
    instanceId: "main",
    displayName: "desktop",
    user: "kuindji",
    sshPort: 22,
    lastKnownPort: 54892,
    attached: false,
    addedAt: "2026-08-23T00:00:00.000Z",
};

describe("buildTunnelArgs", () => {
    test("forwards a local port to loopback on the remote host", () => {
        expect(buildTunnelArgs(record, 7777, 54892)).toEqual([
            "-N",
            "-L",
            // The bind address is explicit. `man ssh`: "By default, the local
            // port is bound in accordance with the GatewayPorts setting" — a
            // user with `GatewayPorts yes` in ~/.ssh/config would otherwise
            // republish the remote backend to their own LAN.
            "127.0.0.1:7777:127.0.0.1:54892",
            "-p",
            "22",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            `UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "HostKeyAlias=taskflow-192.168.1.20-22",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
            "-l",
            "kuindji",
            "--",
            "192.168.1.20",
        ]);
    });

    test("carries a non-default ssh port", () => {
        const args = buildTunnelArgs({ ...record, sshPort: 2222 }, 7777, 54892);
        expect(args).toContain("2222");
    });

    // The whole trust-on-first-use design rests on ssh *refusing* an unknown
    // key, and `~/.ssh/config` can turn that refusal off for every host. This
    // assertion is the one that stops a future edit from dropping the flag.
    test("does not let the user's ssh config decide the host-key policy", () => {
        expect(buildTunnelArgs(record, 7777, 54892)).toContain("StrictHostKeyChecking=yes");
    });

    // A `Host` block with its own UserKnownHostsFile or HostKeyAlias would make
    // ssh check a different file, under a different name, from the one the app
    // wrote an approved key to.
    test("does not let the user's ssh config decide where host keys are looked up", () => {
        const args = buildTunnelArgs(record, 7777, 54892);
        expect(args).toContain(`UserKnownHostsFile=${KNOWN_HOSTS_FILE}`);
        expect(args).toContain("GlobalKnownHostsFile=/dev/null");
        expect(args).toContain(`HostKeyAlias=${hostKeyAlias(record)}`);
    });

    // Runs the real parser: `ssh -G` evaluates options and destination without
    // connecting.
    test.skipIf(!Bun.which("ssh"))(
        "a host with whitespace is reported as an invalid host name",
        async () => {
            const args = buildTunnelArgs({ ...record, host: "bad host" }, 7777, 54892);
            const proc = Bun.spawn(["ssh", "-F", "/dev/null", "-G", ...args], {
                stdout: "ignore",
                stderr: "pipe",
            });
            const stderr = await new Response(proc.stderr).text();
            const exitCode = await proc.exited;
            expect(classifyTunnelFailure(stderr, exitCode).kind).toBe("bad-destination");
        },
    );

    // `-bad@host` is an option cluster to getopt, not a destination.
    test("a user or host beginning with a dash is not read as options", () => {
        const args = buildTunnelArgs({ ...record, user: "-bad", host: "-worse" }, 7777, 54892);
        expect(args.slice(-4)).toEqual(["-l", "-bad", "--", "-worse"]);
    });
});

describe("known hosts helpers", () => {
    test("the trust store is the app's own file", () => {
        expect(KNOWN_HOSTS_FILE).toBe(join(homedir(), ".taskflow", "known_hosts"));
    });

    test("keys are filed under the host key alias", () => {
        expect(knownHostsKey(record)).toBe("taskflow-192.168.1.20-22");
        expect(knownHostsKey({ ...record, sshPort: 2222 })).toBe("taskflow-192.168.1.20-2222");
    });

    test("the alias follows how the machine is reached", () => {
        expect(hostKeyAlias({ ...record, host: "desktop.local" })).not.toBe(hostKeyAlias(record));
        expect(hostKeyAlias({ ...record, sshPort: 2222 })).not.toBe(hostKeyAlias(record));
    });

    // Task 9 rekeys a record onto its uid at the first handshake, moments
    // after the user approved its key. The alias must survive that.
    test("the alias does not change when the record learns its uid", () => {
        const confirmed = { ...record, id: "abc123", backendUid: "abc123" };
        expect(hostKeyAlias(confirmed)).toBe(hostKeyAlias(record));
    });

    // ssh splits `-o` values on whitespace and rejects stray quotes, so a raw
    // alias made `bad host` fail on the option ("extra arguments at end of
    // line") before ssh could say the host name is invalid.
    test("the alias is a single token ssh can parse, whatever the host holds", () => {
        const hosts = ["bad host", "x\nProxyCommand y", "a\tb", 'a"b', "a'b", "a\\b"];
        for (const host of hosts) {
            const unparsable = Array.from(hostKeyAlias({ ...record, host })).filter((char) => {
                const code = char.charCodeAt(0);
                return code <= 0x20 || code === 0x7f || `"'\\`.includes(char);
            });
            expect(unparsable).toEqual([]);
        }
    });

    // The alias is also the first field of a known_hosts line, where `*` and
    // `?` are wildcards, `!` negates and `,` separates patterns: a line filed
    // under `taskflow-*-22` would vouch for every machine on port 22.
    test("the alias holds no known_hosts pattern syntax", () => {
        for (const host of ["*", "desk?op", "!a", "a,b"]) {
            expect(hostKeyAlias({ ...record, host })).not.toMatch(/[*?!,]/);
        }
    });

    test("encoding the alias keeps distinct hosts apart", () => {
        expect(hostKeyAlias({ ...record, host: "a b" })).not.toBe(
            hostKeyAlias({ ...record, host: "a%20b" }),
        );
        expect(hostKeyAlias({ ...record, host: "desktop.local" })).toBe(
            "taskflow-desktop.local-22",
        );
    });

    test("keyscan queries the host on its ssh port", () => {
        expect(buildKeyscanArgs(record)).toEqual(["-T", "5", "-p", "22", "--", "192.168.1.20"]);
    });
});

describe("classifyTunnelFailure", () => {
    test("unknown host key", () => {
        const failure = classifyTunnelFailure("Host key verification failed.\r\n", 255);
        expect(failure.kind).toBe("unknown-host-key");
    });

    test("changed host key is not the same as an unknown one", () => {
        const failure = classifyTunnelFailure(
            "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nHost key verification failed.",
            255,
        );
        expect(failure.kind).toBe("changed-host-key");
    });

    test("auth refused", () => {
        expect(
            classifyTunnelFailure("kuindji@host: Permission denied (publickey).", 255).kind,
        ).toBe("auth-refused");
    });

    test("no route", () => {
        expect(classifyTunnelFailure("ssh: Could not resolve hostname desktop", 255).kind).toBe(
            "no-route",
        );
        expect(
            classifyTunnelFailure("ssh: connect to host 1.2.3.4 port 22: Connection refused", 255)
                .kind,
        ).toBe("no-route");
    });

    // macOS spells ETIMEDOUT and ENETUNREACH this way; the first is what ssh
    // prints for a machine that is asleep or off the network.
    test("no route, in the operating system's own words", () => {
        expect(
            classifyTunnelFailure(
                "ssh: connect to host 10.255.255.1 port 22: Operation timed out",
                255,
            ).kind,
        ).toBe("no-route");
        expect(
            classifyTunnelFailure(
                "ssh: connect to host 1.2.3.4 port 22: Network is unreachable",
                255,
            ).kind,
        ).toBe("no-route");
    });

    test("local bind failure, which is retried rather than shown", () => {
        const failure = classifyTunnelFailure(
            "bind [127.0.0.1]:7777: Address already in use\nCould not request local forwarding.",
            255,
        );
        expect(failure.kind).toBe("local-bind-failed");
    });

    test("missing ssh binary", () => {
        expect(classifyTunnelFailure("spawn ssh ENOENT", null).kind).toBe("no-ssh-binary");
    });

    test("a rejected user or host names the field rather than dumping usage", () => {
        expect(classifyTunnelFailure("remote username contains invalid characters", 255).kind).toBe(
            "bad-destination",
        );
        expect(classifyTunnelFailure("hostname contains invalid characters", 255).kind).toBe(
            "bad-destination",
        );
    });

    test("an unrecognised failure keeps the raw stderr", () => {
        const failure = classifyTunnelFailure("something nobody predicted", 1);
        expect(failure.kind).toBe("unknown");
        expect(failure.stderr).toBe("something nobody predicted");
    });
});
