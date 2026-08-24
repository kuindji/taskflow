import { backendUrl } from "./net/client";

/**
 * Command-line options, parsed as a pure function so the whole surface is
 * testable without spawning a backend or opening a socket.
 */
interface CliOptions {
    /** Null in local mode, where the TUI spawns a backend of its own. */
    connect: { host: string; port: number } | null;
}

const USAGE = "usage: taskflow-tui [--connect <host:port>] (IPv6 must be bracketed: [::1]:7777)";

/**
 * Whether the target carries whitespace or a C0/DEL control. Checked before the
 * URL parser is consulted, because that parser *deletes* tab, CR and LF from an
 * authority rather than refusing it: `desk<TAB>top:7777` would parse cleanly and
 * quietly dial `desktop`, a different machine from the one that was typed.
 * Written as a scan rather than a regex because the character class would need
 * literal control characters in it, which `no-control-regex` rejects.
 */
function hasControlOrSpace(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x20 || code === 0x7f) return true;
    }
    return false;
}

function usageError(): Error {
    return new Error(`--connect expects host:port. ${USAGE}`);
}

/**
 * Split `host:port`. The host comes back unbracketed, because whatever builds
 * the URL puts the brackets back on (`hostForUrl` in `@taskflow/shared`) and a
 * host that arrives already bracketed would be bracketed twice.
 */
function parseTarget(value: string): { host: string; port: number } {
    if (hasControlOrSpace(value)) throw usageError();

    let host: string;
    let rawPort: string;

    if (value.startsWith("[")) {
        // An IPv6 literal has to be bracketed, because its own colons are
        // otherwise indistinguishable from the one in front of the port.
        const close = value.indexOf("]");
        if (close === -1 || value[close + 1] !== ":") throw usageError();
        host = value.slice(1, close);
        rawPort = value.slice(close + 2);
    } else {
        // Splitting on the first colon rejects a bare IPv6 address rather than
        // guessing at it: `::1` gives the empty host, and `2001:db8::1` gives
        // the port `db8::1`, and neither survives the checks below. The two
        // readings of `2001:db8::1` — an address with a port and one without —
        // cannot be told apart, which is why the brackets are required.
        const separator = value.indexOf(":");
        if (separator <= 0) throw usageError();
        host = value.slice(0, separator);
        rawPort = value.slice(separator + 1);
    }

    // parseInt would accept "123abc" as 123, so require digits only.
    if (!/^\d+$/.test(rawPort)) throw usageError();
    const port = Number.parseInt(rawPort, 10);
    if (port < 1 || port > 65535) throw usageError();

    // The host is validated by building the URL that will actually be dialled
    // and asking whether it parses. A regex matching the *shape* of a host
    // accepts literals no URL parser does — `[fe80::1%en0]`, `[:]`, `%zz` —
    // and each of those then fails inside `new WebSocket` as a bare
    // `TypeError: Invalid URL`, long after the point where a usage error could
    // still be printed. Asking the parser is also the only check that cannot
    // drift from what is dialled, because it builds the very same string.
    if (!URL.canParse(backendUrl(host, port))) throw usageError();
    return { host, port };
}

function parseArgs(argv: string[]): CliOptions {
    let connect: CliOptions["connect"] = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg.startsWith("--connect=")) {
            connect = parseTarget(arg.slice("--connect=".length));
            continue;
        }
        if (arg === "--connect") {
            const value = argv[i + 1];
            if (value === undefined) throw usageError();
            connect = parseTarget(value);
            i++;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
    }

    return { connect };
}

export { parseArgs };
