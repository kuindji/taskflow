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

/**
 * Resolve `relative` against `baseDir`. An absolute `relative` wins outright.
 * `..` never climbs above the root (or the drive prefix), so a crafted link
 * cannot produce a path shaped like an escape; the backend still re-validates
 * every path it is handed.
 */
function joinRelative(baseDir: string, relative: string): string {
    const target = toPosix(relative);
    const base = toPosix(baseDir);
    const source = isAbsolutePath(target) ? target : `${base}/${target}`;
    const drive = DRIVE.exec(source)?.[1] ?? "";
    const rooted = drive !== "" || source.startsWith("/");
    const segments = source.slice(drive.length).split("/");
    const out: string[] = [];

    for (const raw of segments) {
        const segment = decodeSegment(raw);
        if (segment === "" || segment === ".") continue;
        if (segment === "..") {
            out.pop();
            continue;
        }
        out.push(segment);
    }

    const joined = out.join("/");
    if (drive !== "") return `${drive}/${joined}`;
    return rooted ? `/${joined}` : joined;
}

export { dirnameOf, isAbsolutePath, joinRelative };
