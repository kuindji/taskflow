/**
 * POSIX-style path helpers for the renderer. Node's `path` is not available
 * in the browser bundle, and workspace paths are already normalised to
 * forward slashes by the backend (`file-watcher.ts` `normalizePath`).
 */

function toPosix(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

function dirnameOf(filePath: string): string {
    const normalized = toPosix(filePath);
    const index = normalized.lastIndexOf("/");
    return index <= 0 ? "" : normalized.slice(0, index);
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

/** POSIX root, or a Windows drive prefix once backslashes are normalised. */
const ABSOLUTE = /^(?:\/|[A-Za-z]:\/)/;
const DRIVE = /^([A-Za-z]:)\//;

function isAbsolutePath(filePath: string): boolean {
    return ABSOLUTE.test(toPosix(filePath));
}

/** `//server/share` once backslashes are normalised: a Windows UNC root. */
const UNC_ROOT = /^\/\/[^/]+\/[^/]+/;

interface JoinOptions {
    /**
     * Percent-decode the segments of `relative` (default true): a markdown
     * href arrives URL-encoded. `baseDir` is a filesystem path and is never
     * decoded.
     */
    decode?: boolean;
}

/**
 * Resolve `relative` against `baseDir`. An absolute `relative` wins outright.
 * `..` never climbs above the root (the drive prefix, or a UNC share), so a
 * crafted link cannot produce a path shaped like an escape; the backend still
 * re-validates every path it is handed.
 */
function joinRelative(baseDir: string, relative: string, options: JoinOptions = {}): string {
    const target = toPosix(relative);
    const decodeTarget = options.decode ?? true;
    const parts = isAbsolutePath(target)
        ? [{ path: target, decode: decodeTarget }]
        : [
              { path: toPosix(baseDir), decode: false },
              { path: target, decode: decodeTarget },
          ];
    const source = parts[0].path;
    const root = UNC_ROOT.exec(source)?.[0] ?? DRIVE.exec(source)?.[1] ?? "";
    const rooted = root !== "" || source.startsWith("/");
    parts[0] = { ...parts[0], path: source.slice(root.length) };
    const out: string[] = [];

    for (const part of parts) {
        for (const raw of part.path.split("/")) {
            const segment = part.decode ? decodeSegment(raw) : raw;
            if (segment === "" || segment === ".") continue;
            if (segment === "..") {
                out.pop();
                continue;
            }
            out.push(segment);
        }
    }

    const joined = out.join("/");
    if (root !== "") return `${root}/${joined}`;
    return rooted ? `/${joined}` : joined;
}

export { dirnameOf, isAbsolutePath, joinRelative };
