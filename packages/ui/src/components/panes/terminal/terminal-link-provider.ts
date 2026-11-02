import type { Terminal, ILink, ILinkProvider } from "@xterm/xterm";
import { sendRequest } from "@/lib/connection-registry";
import { MSG } from "@taskflow/shared";
import type { FileStatResponse, SessionOwnerRef } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useUIStore } from "@/stores/ui-store";
import { openFileInApp } from "@/lib/open-file";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { registerBackendReset } from "@/stores/store-reset";
import { useBackendStore } from "@/stores/backend-store";
import { isLocalBackend } from "@/hooks/useIsLocalBackend";
import { getWrappedLineWindow, getWrappedRangeForMatch } from "@/lib/terminal-wrapped-links";
import { nativePath, resolveWithin, relativeTo, type PathFlavour } from "@/lib/path-flavour";
import {
    backendPathFlavour,
    getWorkingDir,
    openExternalFile,
    sessionWorkspace,
} from "./terminal-links";

// Absolute: /path/to/file with optional :line:col
const ABS_PATH_RE = /(?<![/\w.@+-])(\/[\w.@+-]+(?:\/[\w.@+-]*)*(?::(\d+)(?::(\d+))?)?)/g;

// Relative: dir/file or ./dir/file with optional :line:col
// Must contain at least one "/". False positives (e.g., "yes/no") are acceptable
// because the file:stat check at click time gracefully handles non-existent paths.
const REL_PATH_RE =
    /(?<![/\w.@+-])((?:\.\.?\/)?[\w.@+-]+\/[\w.@+\-/]*[\w.@+-](?::(\d+)(?::(\d+))?)?)/g;

// Windows: C:\path\file or C:/path/file, and relative paths with either separator.
const WINDOWS_ABS_PATH_RE = /(?<![\w.@+\-\\/])([A-Za-z]:[\\/][\w.@+\-\\/]*(?::(\d+)(?::(\d+))?)?)/g;
const WINDOWS_REL_PATH_RE =
    /(?<![\\/\w.@+-])((?:\.\.?[\\/])?[\w.@+-]+[\\/][\w.@+\-\\/]*[\w.@+-](?::(\d+)(?::(\d+))?)?)/g;

const PATH_RES: Record<PathFlavour, RegExp[]> = {
    posix: [ABS_PATH_RE, REL_PATH_RE],
    windows: [WINDOWS_ABS_PATH_RE, WINDOWS_REL_PATH_RE],
};

// Bare filenames: dotfiles (.gitignore, .env.local) or files with extensions (package.json, CLAUDE.md),
// with optional :line:col (app.ts:42:3). Bounded by whitespace, sentence punctuation, or line edges to avoid false positives on embedded substrings.
// Does NOT match extensionless names (src, LICENSE) — too many false positives.
const BARE_NAME_RE =
    /(?<=^|\s)((?:\.[\w.@+-]+|[\w@+-][\w.@+-]*\.[\w@+-]{1,15})(?::\d+(?::\d+)?)?)(?=[\s.,;:!?)\]}'"]|$)/g;

// Sentence-ending punctuation that should be stripped off the right edge of a
// matched path so the path itself stays clickable (e.g. "file.md." → "file.md").
const TRAILING_PUNCT_RE = /[.,;:!?'")\]}]+$/;

function trimTrailingPunctuation(match: string): string {
    // A :line[:col] suffix ends in a digit — leave those intact.
    if (/\d$/.test(match)) return match;
    return match.replace(TRAILING_PUNCT_RE, "");
}

function resolvePath(raw: string, workingDir: string | null, flavour: PathFlavour): string | null {
    if (!raw || !workingDir) return null;
    return resolveWithin(raw.replace(/:\d+(?::\d+)?$/, ""), workingDir, flavour);
}

// ─── File stat cache for bare-name link validation ──────────────────────────

interface CachedStat {
    exists: boolean;
    isDirectory: boolean;
    ts: number;
}

/**
 * Per machine, then by absolute path: two machines holding one repository at
 * one path would otherwise answer for each other.
 */
const fileStatCache = new Map<string, Map<string, CachedStat>>();
const STAT_CACHE_TTL_MS = 10_000;

registerBackendReset("file-stat-cache", (backendId) => {
    fileStatCache.delete(backendId);
});

async function cachedFileStat(
    backendId: string | null,
    absolutePath: string,
): Promise<{ exists: boolean; isDirectory: boolean }> {
    if (!backendId) return { exists: false, isDirectory: false };
    let stats = fileStatCache.get(backendId);
    if (!stats) {
        stats = new Map();
        fileStatCache.set(backendId, stats);
    }
    const cached = stats.get(absolutePath);
    if (cached && Date.now() - cached.ts < STAT_CACHE_TTL_MS) {
        return cached;
    }
    try {
        const result = await sendRequest<FileStatResponse>(backendId, MSG.FILE_STAT, {
            path: absolutePath,
        });
        // A detach while this was in flight dropped the machine's entries.
        if (fileStatCache.get(backendId) === stats) {
            stats.set(absolutePath, { ...result, ts: Date.now() });
        }
        return result;
    } catch {
        return { exists: false, isDirectory: false };
    }
}

function createFilePathLinkProvider(
    term: Terminal,
    sessionId: string,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): ILinkProvider {
    // Resolved at click time: the session may have moved since this terminal mounted.
    const activate = (
        text: string,
        workingDir: string | null,
        flavour: PathFlavour,
        event: MouseEvent,
    ) => {
        const { workspaceKey, owner } = sessionWorkspace(sessionId, taskId, projectId, master);
        void handlePathActivation(text, workingDir, flavour, workspaceKey, event, owner);
    };

    return {
        provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
            const wrappedLine = getWrappedLineWindow(term, bufferLineNumber - 1);
            if (!wrappedLine) {
                callback(undefined);
                return;
            }

            const workingDir = getWorkingDir(sessionId, taskId, projectId, master);
            const { workspaceKey } = sessionWorkspace(sessionId, taskId, projectId, master);
            const backendId = workspaceKey ? workspaceBackendId(workspaceKey) : null;
            // The session's machine spells the paths it prints, not this one.
            const flavour = backendPathFlavour(backendId);
            const lineText = wrappedLine.text;
            const links: ILink[] = [];
            const seen = new Set<string>();

            for (const re of PATH_RES[flavour]) {
                re.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = re.exec(lineText)) !== null) {
                    const rawMatch = match[1];
                    const trimmed = trimTrailingPunctuation(rawMatch);
                    if (trimmed.length === 0) continue;
                    const matchIndex = match.index + (match[0].length - rawMatch.length);

                    // Deduplicate overlapping matches
                    const key = `${matchIndex}:${trimmed.length}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const resolved = resolvePath(trimmed, workingDir, flavour);
                    if (!resolved) continue;

                    const range = getWrappedRangeForMatch(
                        term,
                        wrappedLine.startLineIndex,
                        matchIndex,
                        trimmed.length,
                    );
                    if (!range) continue;

                    links.push({
                        range,
                        text: trimmed,
                        activate(event: MouseEvent, text: string) {
                            activate(text, workingDir, flavour, event);
                        },
                    });
                }
            }

            // Bare filenames (dotfiles, files with extensions) — need async
            // filesystem validation to avoid false-positive hover underlines.
            if (!workingDir) {
                callback(links.length > 0 ? links : undefined);
                return;
            }

            const bareCandidates: Array<{ resolved: string; link: ILink }> = [];
            BARE_NAME_RE.lastIndex = 0;
            let bareMatch: RegExpExecArray | null;
            while ((bareMatch = BARE_NAME_RE.exec(lineText)) !== null) {
                const rawMatch = bareMatch[1];
                const trimmed = trimTrailingPunctuation(rawMatch);
                if (trimmed.length === 0) continue;
                const matchIndex = bareMatch.index + (bareMatch[0].length - rawMatch.length);

                const key = `${matchIndex}:${trimmed.length}`;
                if (seen.has(key)) continue;
                seen.add(key);

                // Without the :line:col suffix; null when it escapes workingDir.
                const resolved = resolvePath(trimmed, workingDir, flavour);
                if (!resolved) continue;

                const range = getWrappedRangeForMatch(
                    term,
                    wrappedLine.startLineIndex,
                    matchIndex,
                    trimmed.length,
                );
                if (!range) continue;

                bareCandidates.push({
                    resolved,
                    link: {
                        range,
                        text: trimmed,
                        activate(event: MouseEvent, text: string) {
                            activate(text, workingDir, flavour, event);
                        },
                    },
                });
            }

            if (bareCandidates.length === 0) {
                callback(links.length > 0 ? links : undefined);
                return;
            }

            // Validate bare candidates against filesystem before exposing as links
            void Promise.all(bareCandidates.map((c) => cachedFileStat(backendId, c.resolved))).then(
                (results) => {
                    for (let i = 0; i < results.length; i++) {
                        if (results[i].exists) links.push(bareCandidates[i].link);
                    }
                    callback(links.length > 0 ? links : undefined);
                },
            );
        },
    };
}

/**
 * A path inside the explorer's tree as its nodes spell it. A Windows backend
 * lists them with forward slashes (`file-watcher.ts` `normalizePath`).
 */
function treeNodePath(treePath: string, relative: string, flavour: PathFlavour): string {
    if (relative === "") return treePath;
    const spell = (path: string) => (flavour === "windows" ? path.replace(/\\/g, "/") : path);
    const root = spell(treePath);
    return `${root.endsWith("/") ? root.slice(0, -1) : root}/${spell(relative)}`;
}

async function handlePathActivation(
    text: string,
    workingDir: string | null,
    flavour: PathFlavour,
    workspaceKey: string | null,
    event: MouseEvent,
    owner?: SessionOwnerRef,
): Promise<void> {
    const resolved = resolvePath(text, workingDir, flavour);
    if (!resolved) return;

    const lineMatch = text.match(/:(\d+)(?::(\d+))?$/);
    const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
    const col = lineMatch?.[2] ? Number(lineMatch[2]) : undefined;

    const backendId = workspaceKey ? workspaceBackendId(workspaceKey) : null;
    const stat = await cachedFileStat(backendId, resolved);
    if (!stat.exists) return;

    // Finder and the external editor see this machine's files: a path on
    // another machine opens in the app instead.
    const isLocal = isLocalBackend(useBackendStore.getState().machines, backendId);
    const isExternal = (event.metaKey || event.ctrlKey) && isLocal;

    if (stat.isDirectory) {
        // A moved session's directory can lie outside the explorer's tree,
        // which cannot show it: Finder can, on this machine.
        const { treePath } = useFileStore.getState();
        const inTree = treePath !== null ? relativeTo(treePath, resolved, flavour) : null;
        if (isExternal || (inTree === null && isLocal)) {
            window.taskflow?.showItemInFolder(nativePath(resolved, flavour));
        } else if (treePath !== null && inTree !== null) {
            void useFileStore
                .getState()
                .expandToPathAndLoad(treeNodePath(treePath, inTree, flavour));
            if (!useUIStore.getState().fileExplorerOpen) {
                useUIStore.getState().toggleFileExplorer();
            }
        }
    } else {
        if (isExternal) {
            openExternalFile(nativePath(resolved, flavour), { line, col });
        } else {
            void openFileInApp(resolved, workspaceKey, owner, line);
        }
    }
}

export { createFilePathLinkProvider };
