/**
 * Command-line options, parsed as a pure function so the whole surface is
 * testable without spawning a backend or opening a socket.
 */
interface CliOptions {
    /** Null in local mode, where the TUI spawns a backend of its own. */
    connect: { host: string; port: number } | null;
}

const USAGE = "usage: taskflow-tui [--connect <host:port>] (IPv6 must be bracketed: [::1]:7777)";

/** A name, an IPv4 literal, or a percent-encoded name — anything but a colon. */
const PLAIN_HOST = /^[A-Za-z0-9._~%+-]+$/;
/** Inside the brackets: an IPv6 literal, optionally carrying a zone id. */
const IPV6_HOST = /^[0-9A-Fa-f.]*:[0-9A-Fa-f.:]*(?:%[A-Za-z0-9._~-]+)?$/;

function usageError(): Error {
    return new Error(`--connect expects host:port. ${USAGE}`);
}

/**
 * Split `host:port`. The host comes back unbracketed, because whatever builds
 * the URL puts the brackets back on (`hostForUrl` in `@taskflow/shared`) and a
 * host that arrives already bracketed would be bracketed twice.
 */
function parseTarget(value: string): { host: string; port: number } {
    let host: string;
    let rawPort: string;

    if (value.startsWith("[")) {
        // An IPv6 literal has to be bracketed, because its own colons are
        // otherwise indistinguishable from the one in front of the port.
        const close = value.indexOf("]");
        if (close === -1 || value[close + 1] !== ":") throw usageError();
        host = value.slice(1, close);
        rawPort = value.slice(close + 2);
        if (!IPV6_HOST.test(host)) throw usageError();
    } else {
        const separator = value.indexOf(":");
        if (separator <= 0) throw usageError();
        host = value.slice(0, separator);
        rawPort = value.slice(separator + 1);
        // Rejects a bare IPv6 address as well as a host with a space in it:
        // `::1` would otherwise split into the host `:` and the port 1, which
        // parses happily and then fails as an unopenable URL much later.
        if (!PLAIN_HOST.test(host)) throw usageError();
    }

    // parseInt would accept "123abc" as 123, so require digits only.
    if (!/^\d+$/.test(rawPort)) throw usageError();
    const port = Number.parseInt(rawPort, 10);
    if (port < 1 || port > 65535) throw usageError();
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
