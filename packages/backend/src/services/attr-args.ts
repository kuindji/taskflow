// Pure positional/flag splitting for `taskflow-cli attr` subcommands. Kept
// free of process.exit / stderr side effects so it can be unit tested
// directly — see attr-scope.ts for the sibling pattern this follows.
//
// Attr subcommands mix positional args (name/value/id) with flags, and either
// one may legitimately start with "--" (e.g. an attribute value of
// "--weird", or a name that collides with a flag token like "--own"). To
// avoid a positional being misread as a flag (and vice versa), leading args
// are collected as positionals first: unconditionally while a *required*
// positional slot remains unfilled (a required slot must be satisfied even
// by a flag-looking token), and only stopping early at a *known* attr flag
// name once the optional slots begin. The rest goes to parseFlags.
const ATTR_FLAG_NAMES = new Set(["--task-id", "--project-id", "--own"]);

interface SplitAttrArgsResult {
    positional: string[];
    flagArgs: string[];
}

function splitAttrArgs(
    args: string[],
    requiredPositional: number,
    maxPositional: number,
): SplitAttrArgsResult {
    const positional: string[] = [];
    let i = 0;
    while (i < args.length && positional.length < maxPositional) {
        const inRequiredSlot = positional.length < requiredPositional;
        if (!inRequiredSlot && ATTR_FLAG_NAMES.has(args[i])) break;
        positional.push(args[i]);
        i += 1;
    }
    return { positional, flagArgs: args.slice(i) };
}

export { splitAttrArgs, ATTR_FLAG_NAMES };
