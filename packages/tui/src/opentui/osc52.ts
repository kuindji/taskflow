const OSC52_PREFIX = "\x1b]52;";
const MAX_OSC52_SEQUENCE_BYTES = 1024 * 1024;

type Osc52Target = "clipboard" | "primary" | "select";

interface Osc52Sink {
    copy(text: string, target: Osc52Target): void;
    clear(target: Osc52Target): void;
}

function targetFor(value: string): Osc52Target | null {
    if (value === "c") return "clipboard";
    if (value === "p") return "primary";
    if (value === "s") return "select";
    return null;
}

function decodeBase64(value: string): string | null {
    if (value.length === 0) return "";
    if (value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null;
    const firstPadding = value.indexOf("=");
    if (firstPadding >= 0 && firstPadding < value.length - 2) return null;
    try {
        const padded = value.padEnd(Math.ceil(value.length / 4) * 4, "=");
        const bytes = Buffer.from(padded, "base64");
        if (bytes.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) return null;
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

function partialPrefixAtEnd(value: string): string {
    const limit = Math.min(value.length, OSC52_PREFIX.length - 1);
    for (let length = limit; length > 0; length -= 1) {
        const suffix = value.slice(-length);
        if (OSC52_PREFIX.startsWith(suffix)) return suffix;
    }
    return "";
}

class Osc52Scanner {
    private partial = "";

    constructor(private readonly sink: Osc52Sink) {}

    feed(chunk: string): void {
        const data = this.partial + chunk;
        this.partial = "";
        let cursor = 0;

        while (cursor < data.length) {
            const start = data.indexOf(OSC52_PREFIX, cursor);
            if (start < 0) {
                this.partial = partialPrefixAtEnd(data.slice(cursor));
                return;
            }
            const bodyStart = start + OSC52_PREFIX.length;
            const bel = data.indexOf("\x07", bodyStart);
            const st = data.indexOf("\x1b\\", bodyStart);
            const terminator = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
            if (terminator < 0) {
                if (data.length - start <= MAX_OSC52_SEQUENCE_BYTES) {
                    this.partial = data.slice(start);
                    return;
                }
                cursor = bodyStart;
                continue;
            }
            const terminatorLength = terminator === st ? 2 : 1;
            if (terminator + terminatorLength - start <= MAX_OSC52_SEQUENCE_BYTES) {
                this.handle(data.slice(bodyStart, terminator));
            }
            cursor = terminator + terminatorLength;
        }
    }

    reset(): void {
        this.partial = "";
    }

    private handle(body: string): void {
        const separator = body.indexOf(";");
        if (separator < 0) return;
        const target = targetFor(body.slice(0, separator));
        if (!target) return;
        const payload = body.slice(separator + 1);
        if (payload === "?") return;
        if (payload === "") {
            this.sink.clear(target);
            return;
        }
        const decoded = decodeBase64(payload);
        if (decoded !== null) this.sink.copy(decoded, target);
    }
}

export { MAX_OSC52_SEQUENCE_BYTES, Osc52Scanner };
export type { Osc52Sink, Osc52Target };
