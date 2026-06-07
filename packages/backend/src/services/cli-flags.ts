type FlagSpec = Record<string, "string" | "boolean">;

interface ParsedFlags {
    flags: Record<string, string | boolean>;
    positional: string[];
    unknown: string[];
}

function consumeFlags(args: string[], spec: FlagSpec): ParsedFlags {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    const unknown: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            if (arg === "--") {
                // POSIX end-of-flags sentinel: everything after is positional
                positional.push(...args.slice(i + 1));
                break;
            }
            const name = arg.slice(2);
            const kind = spec[name];
            if (kind === "boolean") {
                flags[name] = true;
                i++;
            } else if (kind === "string") {
                flags[name] = args[i + 1] ?? "";
                i += 2;
            } else {
                unknown.push(arg);
                i++;
            }
        } else {
            positional.push(arg);
            i++;
        }
    }
    return { flags, positional, unknown };
}

export { consumeFlags };
