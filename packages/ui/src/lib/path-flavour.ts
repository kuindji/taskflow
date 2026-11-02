/**
 * Paths as the session's backend spells them, which need not be how this
 * UI's machine does: a Windows backend attached from a Mac names files
 * `C:\repo\a.ts`. Pure string work, no filesystem I/O.
 */

type PathFlavour = "posix" | "windows";

/** How a terminal's input line quotes a dropped path or text. */
type QuoteDialect = "posix" | "powershell" | "cmd";

/** From the handshake's `SystemInfo.os`; absent (an older backend) is POSIX. */
function pathFlavour(os: string | undefined): PathFlavour {
    return os === "win32" ? "windows" : "posix";
}

function separator(flavour: PathFlavour): string {
    return flavour === "windows" ? "\\" : "/";
}

const WINDOWS_DRIVE_RE = /^[A-Za-z]:(?=[\\/])/;
const WINDOWS_UNC_RE = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;

function isAbsolutePath(path: string, flavour: PathFlavour): boolean {
    if (flavour === "posix") return path.startsWith("/");
    return WINDOWS_DRIVE_RE.test(path) || WINDOWS_UNC_RE.test(path);
}

/** Collapse `.` and `..` segments and duplicate separators in an absolute path. */
function normalizeAbsolute(absolute: string, flavour: PathFlavour): string {
    let root = "";
    let rest = absolute;
    if (flavour === "windows") {
        const drive = WINDOWS_DRIVE_RE.exec(absolute);
        const unc = drive ? null : WINDOWS_UNC_RE.exec(absolute);
        const prefix = drive?.[0] ?? unc?.[0] ?? "";
        root = prefix.replace(/\//g, "\\");
        rest = absolute.slice(prefix.length);
    }
    const stack: string[] = [];
    for (const part of rest.split(flavour === "windows" ? /[\\/]/ : "/")) {
        if (part === "..") stack.pop();
        else if (part && part !== ".") stack.push(part);
    }
    const sep = separator(flavour);
    // A UNC share is its own root; a drive's root is `C:\`.
    if (stack.length === 0 && WINDOWS_UNC_RE.test(root)) return root;
    return root + sep + stack.join(sep);
}

/**
 * Where an absolute `path` lies under `root`, as a relative path in the
 * flavour's separator: "" for the root itself, null outside it. Windows
 * compares without case, as its filesystems do.
 */
function relativeTo(root: string, path: string, flavour: PathFlavour): string | null {
    const base = normalizeAbsolute(root, flavour);
    const target = normalizeAbsolute(path, flavour);
    const fold = (value: string) => (flavour === "windows" ? value.toLowerCase() : value);
    if (fold(target) === fold(base)) return "";
    const sep = separator(flavour);
    const prefix = base.endsWith(sep) ? base : base + sep;
    if (!fold(target).startsWith(fold(prefix))) return null;
    return target.slice(prefix.length);
}

/**
 * A path a terminal printed, resolved against the session's working
 * directory: absolute and normalized, spelled with the directory's own case
 * on Windows. Null when it lies outside that directory.
 *
 * Spelled as the backend's file APIs and explorer tree spell paths, which on
 * Windows is with forward slashes (`file-watcher.ts` `normalizePath`): a file
 * opened from a link is then the same editor tab as from the explorer.
 */
function resolveWithin(path: string, workingDir: string, flavour: PathFlavour): string | null {
    const sep = separator(flavour);
    const absolute = isAbsolutePath(path, flavour) ? path : workingDir + sep + path;
    const relative = relativeTo(workingDir, absolute, flavour);
    if (relative === null) return null;
    const base = normalizeAbsolute(workingDir, flavour);
    const resolved =
        relative === "" ? base : base.endsWith(sep) ? base + relative : base + sep + relative;
    return flavour === "windows" ? resolved.replace(/\\/g, "/") : resolved;
}

/** As the OS itself spells it, for Explorer and external editors: backslashes on Windows. */
function nativePath(path: string, flavour: PathFlavour): string {
    return flavour === "windows" ? path.replace(/\//g, "\\") : path;
}

/** A `file:` URI as the flavour's path; null for anything else. */
function fileUriToPath(uri: string, flavour: PathFlavour): string | null {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return null;
    }
    if (url.protocol !== "file:") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (flavour === "posix") return pathname;
    // `file:///C:/repo/a.ts` has the pathname `/C:/repo/a.ts`.
    const local = /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : pathname;
    const path = local.replace(/\//g, "\\");
    return url.host ? `\\\\${url.host}${path}` : path;
}

const POSIX_UNSAFE = /[^a-zA-Z0-9_./:@=+-]/;
const WINDOWS_UNSAFE = /[^a-zA-Z0-9_.\\/:+-]/;

function shellQuote(text: string, dialect: QuoteDialect): string {
    if (dialect === "posix") {
        if (!POSIX_UNSAFE.test(text)) return text;
        return `'${text.replace(/'/g, "'\\''")}'`;
    }
    if (!WINDOWS_UNSAFE.test(text)) return text;
    // PowerShell also closes a single-quoted string on the typographic quotes.
    if (dialect === "powershell") return `'${text.replace(/['‘’‚‛]/g, "$&$&")}'`;
    // Windows file names cannot contain `"`; other dropped text doubles it.
    return `"${text.replace(/"/g, '""')}"`;
}

/**
 * POSIX quoting on POSIX backends and for bash on Windows; PowerShell's and
 * cmd's own for those shells. Agents, and shells of unknown name, get double
 * quotes on Windows: every Windows program splits arguments on them.
 */
function quoteDialect(flavour: PathFlavour, shell: string | undefined): QuoteDialect {
    if (flavour === "posix") return "posix";
    if (shell === "pwsh" || shell === "powershell") return "powershell";
    if (shell === "bash" || shell === "sh" || shell === "zsh") return "posix";
    return "cmd";
}

export type { PathFlavour, QuoteDialect };
export {
    pathFlavour,
    relativeTo,
    resolveWithin,
    nativePath,
    fileUriToPath,
    shellQuote,
    quoteDialect,
};
