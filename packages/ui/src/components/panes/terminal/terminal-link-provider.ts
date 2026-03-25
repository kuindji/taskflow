import type { Terminal, ILink, ILinkProvider } from "@xterm/xterm";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { FileStatResponse } from "@taskflow/shared";
import { useFileStore } from "@/stores/file-store";
import { useUIStore } from "@/stores/ui-store";
import { openFileInApp } from "@/lib/open-file";
import { getWrappedLineWindow, getWrappedRangeForMatch } from "@/lib/terminal-wrapped-links";
import { getWorkspaceKey, getWorkingDir, openExternalFile } from "./terminal-links";

// Absolute: /path/to/file with optional :line:col
const ABS_PATH_RE = /(?<![/\w.@+-])(\/[\w.@+-]+(?:\/[\w.@+-]*)*(?::(\d+)(?::(\d+))?)?)/g;

// Relative: dir/file or ./dir/file with optional :line:col
// Must contain at least one "/". False positives (e.g., "yes/no") are acceptable
// because the file:stat check at click time gracefully handles non-existent paths.
const REL_PATH_RE =
    /(?<![/\w.@+-])((?:\.\.?\/)?[\w.@+-]+\/[\w.@+\-/]*[\w.@+-](?::(\d+)(?::(\d+))?)?)/g;

// Bare filenames: dotfiles (.gitignore, .env.local) or files with extensions (package.json, CLAUDE.md).
// Bounded by whitespace or line edges to avoid false positives on embedded substrings.
// Does NOT match extensionless names (src, LICENSE) — too many false positives.
const BARE_NAME_RE = /(?<=^|\s)(\.[\w.@+-]+|[\w@+-][\w.@+-]*\.[\w@+-]{1,15})(?=\s|$)/g;

/** Collapse `.` and `..` segments in an absolute path without filesystem I/O. */
function normalizePath(absolute: string): string {
    const parts = absolute.split("/");
    const stack: string[] = [];
    for (const p of parts) {
        if (p === "..") stack.pop();
        else if (p && p !== ".") stack.push(p);
    }
    return "/" + stack.join("/");
}

function resolvePath(raw: string, workingDir: string | null): string | null {
    if (!raw) return null;
    const pathOnly = raw.replace(/:\d+(?::\d+)?$/, "");
    if (pathOnly.startsWith("/")) {
        // Absolute: must be within workingDir
        if (!workingDir) return null;
        if (pathOnly !== workingDir && !pathOnly.startsWith(workingDir + "/")) {
            return null;
        }
        return pathOnly;
    }
    // Relative: resolve against workingDir
    if (!workingDir) return null;
    const normalized = normalizePath(workingDir + "/" + pathOnly);
    // Reject paths that escape workingDir via ../
    if (normalized !== workingDir && !normalized.startsWith(workingDir + "/")) {
        return null;
    }
    return normalized;
}

// ─── File stat cache for bare-name link validation ──────────────────────────

interface CachedStat {
    exists: boolean;
    isDirectory: boolean;
    ts: number;
}

const fileStatCache = new Map<string, CachedStat>();
const STAT_CACHE_TTL_MS = 10_000;

async function cachedFileStat(
    absolutePath: string,
): Promise<{ exists: boolean; isDirectory: boolean }> {
    const cached = fileStatCache.get(absolutePath);
    if (cached && Date.now() - cached.ts < STAT_CACHE_TTL_MS) {
        return cached;
    }
    try {
        const result = await sendRequest<FileStatResponse>(MSG.FILE_STAT, {
            path: absolutePath,
        });
        const entry: CachedStat = { ...result, ts: Date.now() };
        fileStatCache.set(absolutePath, entry);
        return result;
    } catch {
        return { exists: false, isDirectory: false };
    }
}

function createFilePathLinkProvider(
    term: Terminal,
    taskId?: string,
    projectId?: string,
    master?: boolean,
): ILinkProvider {
    const workspaceKey = getWorkspaceKey(taskId, projectId, master);

    return {
        provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
            const wrappedLine = getWrappedLineWindow(term, bufferLineNumber - 1);
            if (!wrappedLine) {
                callback(undefined);
                return;
            }

            const workingDir = getWorkingDir(taskId, projectId, master);
            const lineText = wrappedLine.text;
            const links: ILink[] = [];
            const seen = new Set<string>();

            for (const re of [ABS_PATH_RE, REL_PATH_RE]) {
                re.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = re.exec(lineText)) !== null) {
                    const fullMatch = match[1];
                    const matchIndex = match.index + (match[0].length - fullMatch.length);

                    // Deduplicate overlapping matches
                    const key = `${matchIndex}:${fullMatch.length}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const resolved = resolvePath(fullMatch, workingDir);
                    if (!resolved) continue;

                    const range = getWrappedRangeForMatch(
                        term,
                        wrappedLine.startLineIndex,
                        matchIndex,
                        fullMatch.length,
                    );
                    if (!range) continue;

                    links.push({
                        range,
                        text: fullMatch,
                        activate(event: MouseEvent, text: string) {
                            void handlePathActivation(
                                text,
                                workingDir,
                                workspaceKey,
                                event,
                                taskId,
                                projectId,
                            );
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
                const fullMatch = bareMatch[1];
                const matchIndex = bareMatch.index + (bareMatch[0].length - fullMatch.length);

                const key = `${matchIndex}:${fullMatch.length}`;
                if (seen.has(key)) continue;
                seen.add(key);

                const resolved = normalizePath(workingDir + "/" + fullMatch);
                // Reject paths that escape workingDir
                if (resolved !== workingDir && !resolved.startsWith(workingDir + "/")) continue;

                const range = getWrappedRangeForMatch(
                    term,
                    wrappedLine.startLineIndex,
                    matchIndex,
                    fullMatch.length,
                );
                if (!range) continue;

                bareCandidates.push({
                    resolved,
                    link: {
                        range,
                        text: fullMatch,
                        activate(event: MouseEvent, text: string) {
                            void handlePathActivation(text, workingDir, workspaceKey, event);
                        },
                    },
                });
            }

            if (bareCandidates.length === 0) {
                callback(links.length > 0 ? links : undefined);
                return;
            }

            // Validate bare candidates against filesystem before exposing as links
            void Promise.all(bareCandidates.map((c) => cachedFileStat(c.resolved))).then(
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

async function handlePathActivation(
    text: string,
    workingDir: string | null,
    workspaceKey: string | null,
    event: MouseEvent,
    taskId?: string,
    projectId?: string,
): Promise<void> {
    const resolved = resolvePath(text, workingDir);
    if (!resolved) return;

    const lineMatch = text.match(/:(\d+)(?::(\d+))?$/);
    const line = lineMatch?.[1] ? Number(lineMatch[1]) : undefined;
    const col = lineMatch?.[2] ? Number(lineMatch[2]) : undefined;

    const stat = await cachedFileStat(resolved);
    if (!stat.exists) return;

    const isExternal = event.metaKey || event.ctrlKey;

    if (stat.isDirectory) {
        if (isExternal) {
            window.taskflow?.showItemInFolder(resolved);
        } else {
            void useFileStore.getState().expandToPathAndLoad(resolved);
            if (!useUIStore.getState().fileExplorerOpen) {
                useUIStore.getState().toggleFileExplorer();
            }
        }
    } else {
        if (isExternal) {
            openExternalFile(resolved, { line, col });
        } else {
            void openFileInApp(resolved, workspaceKey, { taskId, projectId }, line);
        }
    }
}

export { createFilePathLinkProvider };
