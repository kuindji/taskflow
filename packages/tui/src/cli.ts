/**
 * Command-line options, parsed as a pure function so the whole surface is
 * testable without spawning a backend or opening a socket.
 */
interface CliOptions {
    /** Null in local mode, where the TUI spawns a backend of its own. */
    connect: { host: string; port: number } | null;
}

const USAGE = "usage: taskflow-tui [--connect <host:port>]";

function parseTarget(value: string): { host: string; port: number } {
    // Last colon, not the first: a bracketed IPv6 literal carries colons of its
    // own, and only the final one separates the port.
    const separator = value.lastIndexOf(":");
    if (separator <= 0) throw new Error(`--connect expects host:port. ${USAGE}`);
    const host = value.slice(0, separator);
    const rawPort = value.slice(separator + 1);
    // parseInt would accept "123abc" as 123, so require digits only.
    if (!/^\d+$/.test(rawPort)) throw new Error(`--connect expects host:port. ${USAGE}`);
    const port = Number.parseInt(rawPort, 10);
    if (port < 1 || port > 65535) throw new Error(`--connect expects host:port. ${USAGE}`);
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
            if (value === undefined) throw new Error(`--connect expects host:port. ${USAGE}`);
            connect = parseTarget(value);
            i++;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
    }

    return { connect };
}

export { parseArgs };
export type { CliOptions };
