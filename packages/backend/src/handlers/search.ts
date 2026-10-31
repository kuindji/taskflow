import { MSG } from "@taskflow/shared";
import type {
    SearchQueryPayload,
    SearchCancelPayload,
    SearchReplacePayload,
    SearchReplaceAllPayload,
    SearchQueryResponse,
    SearchReplaceResponse,
    SearchReplaceAllResponse,
} from "@taskflow/shared";
import type { SearchFileResult, SearchMatch } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { assertWorkspacePath, assertMutableWorkspacePath } from "../utils/path-validation";
import { readFile, writeFile } from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { buildShellPath } from "../services/shell-path";
import { getRgPath } from "../services/ripgrep";
import { randomUUID } from "crypto";

interface SearchHandlerDeps {
    router: Router;
    taskStore: TaskStore;
}

const activeSearches = new Map<string, ChildProcess>();

function toForwardSlash(p: string): string {
    return p.replace(/\\/g, "/");
}

function buildRgArgs(payload: SearchQueryPayload): string[] {
    const args = ["--json", "--line-number", "--column", "--path-separator", "/"];

    if (!payload.caseSensitive) {
        args.push("--ignore-case");
    }
    if (payload.wholeWord) {
        args.push("--word-regexp");
    }
    // Without a flag rg treats the query as a regex; the UI's literal mode must not.
    args.push(payload.useRegex ? "--pcre2" : "--fixed-strings");
    if (payload.includePattern) {
        for (const pattern of payload.includePattern.split(",")) {
            const trimmed = pattern.trim();
            if (trimmed) args.push("--glob", trimmed);
        }
    }
    if (payload.excludePattern) {
        for (const pattern of payload.excludePattern.split(",")) {
            const trimmed = pattern.trim();
            if (trimmed) args.push("--glob", `!${trimmed}`);
        }
    }

    args.push("--", payload.query, payload.path);
    return args;
}

/** rg sends `bytes` (base64) instead of `text` for data that is not valid UTF-8. */
interface RgData {
    text?: string;
    bytes?: string;
}

interface RgMatchData {
    path: RgData;
    lines: RgData;
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
}

function parseRgOutput(stdout: string): { files: SearchFileResult[]; totalMatches: number } {
    const fileMap = new Map<string, SearchMatch[]>();
    let totalMatches = 0;

    for (const line of stdout.split("\n")) {
        if (!line) continue;
        let parsed: { type: string; data: RgMatchData } | undefined;
        try {
            parsed = JSON.parse(line) as { type: string; data: RgMatchData };
        } catch {
            continue;
        }
        if (parsed.type !== "match") continue;

        const data = parsed.data;
        // A path that is not UTF-8 cannot be named back to the file system as a JS string.
        if (data.path.text === undefined) continue;
        const filePath = toForwardSlash(data.path.text);
        const rawLine =
            data.lines.text !== undefined
                ? Buffer.from(data.lines.text, "utf-8")
                : Buffer.from(data.lines.bytes ?? "", "base64");
        const lineContent = rawLine.toString("utf-8").replace(/\r?\n$/, "");

        let matches = fileMap.get(filePath);
        if (!matches) {
            matches = [];
            fileMap.set(filePath, matches);
        }

        // Convert byte offsets from rg to character offsets for JS string operations
        for (const sub of data.submatches) {
            const charStart = rawLine.subarray(0, sub.start).toString("utf-8").length;
            const charEnd = rawLine.subarray(0, sub.end).toString("utf-8").length;
            matches.push({
                line: data.line_number,
                column: charStart + 1,
                matchLength: charEnd - charStart,
                lineContent,
            });
            totalMatches++;
        }
    }

    const files: SearchFileResult[] = [];
    for (const [path, matches] of fileMap) {
        files.push({ path, matches });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    return { files, totalMatches };
}

/**
 * Builds the regex that expands `$1`, `$&` and the like in a regex-mode
 * replacement at a match rg reported. Sticky, so it only tries the match's own
 * column, and without whole-word anchors: rg already decided the boundaries
 * (its `--word-regexp` is Unicode-aware and differs from JS `\b`). Null when
 * the pattern is PCRE2-only syntax JS cannot compile; the replacement is then
 * inserted as typed.
 */
function buildReplaceRegex(query: string, caseSensitive: boolean): RegExp | null {
    try {
        return new RegExp(query, caseSensitive ? "y" : "iy");
    } catch {
        return null;
    }
}

/** The text that replaces one match, or null when JS does not see rg's match there. */
function replacementAt(
    line: string,
    column: number,
    length: number,
    replacement: string,
    regex: RegExp | null,
): string | null {
    if (!regex) return replacement;
    regex.lastIndex = column;
    const found = regex.exec(line);
    if (!found || found[0].length !== length) return null;
    // A non-global sticky regex replaces exactly the occurrence at lastIndex,
    // with full `$` expansion; cut the replaced span back out of the line.
    regex.lastIndex = column;
    const replaced = line.replace(regex, replacement);
    return replaced.slice(column, replaced.length - (line.length - column - length));
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Replaces the given rg matches. Replace all passes the matches its own rg run
 * just found, so it changes exactly what the search lists; re-matching with a
 * JS regex would disagree with rg on word boundaries and Unicode.
 */
async function replaceInFile(
    filePath: string,
    replacement: string,
    matches: SearchMatch[],
    regex: RegExp | null,
): Promise<number> {
    const bytes = await readFile(filePath);
    let content: string;
    try {
        // Decoding a non-UTF-8 file and writing it back would replace every
        // undecodable byte with U+FFFD, so such files are left alone.
        content = utf8Decoder.decode(bytes);
    } catch {
        return 0;
    }
    // rg strips a UTF-8 BOM before counting columns; the decoder drops it too,
    // and it is written back unchanged.
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? "\uFEFF" : "";
    const lines = content.split("\n");
    const originalLines = [...lines];
    let replacedCount = 0;

    // Right to left, so each splice leaves the columns of the ones still to come.
    const sorted = [...matches].sort((a, b) =>
        a.line !== b.line ? b.line - a.line : b.column - a.column,
    );
    for (const match of sorted) {
        const lineIdx = match.line - 1;
        if (lineIdx < 0 || lineIdx >= lines.length) continue;
        const original = originalLines[lineIdx];
        // Coordinates are only valid for the line the search saw; once the
        // file changed they would overwrite unrelated text.
        if (original.replace(/\r$/, "") !== match.lineContent) continue;
        const colIdx = match.column - 1;
        if (colIdx < 0 || colIdx > original.length) continue;
        // Expanded against the untouched line, so lookarounds see the original text.
        const text = replacementAt(original, colIdx, match.matchLength, replacement, regex);
        if (text === null) continue;
        const line = lines[lineIdx];
        lines[lineIdx] = line.slice(0, colIdx) + text + line.slice(colIdx + match.matchLength);
        replacedCount++;
    }

    if (replacedCount > 0) {
        await writeFile(filePath, bom + lines.join("\n"), "utf-8");
    }
    return replacedCount;
}

export function registerSearchHandlers(deps: SearchHandlerDeps): void {
    const { router, taskStore } = deps;

    router.register(MSG.SEARCH_QUERY, async (payload) => {
        const { path, query } = payload as SearchQueryPayload;
        if (!query) return { result: { files: [], totalMatches: 0, searchId: "" } };

        await assertWorkspacePath(taskStore, path);

        const searchId = randomUUID();
        const args = buildRgArgs(payload as SearchQueryPayload);

        return new Promise<SearchQueryResponse>((resolve) => {
            const child = spawn(getRgPath(), args, {
                env: { ...process.env, PATH: buildShellPath() },
                stdio: ["ignore", "pipe", "pipe"],
            });

            activeSearches.set(searchId, child);
            const chunks: Buffer[] = [];

            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

            child.on("close", () => {
                activeSearches.delete(searchId);
                const stdout = Buffer.concat(chunks).toString("utf-8");
                const { files, totalMatches } = parseRgOutput(stdout);
                resolve({ result: { files, totalMatches, searchId } });
            });

            child.on("error", () => {
                activeSearches.delete(searchId);
                resolve({ result: { files: [], totalMatches: 0, searchId } });
            });
        });
    });

    router.register(MSG.SEARCH_CANCEL, async (payload) => {
        const { searchId } = payload as SearchCancelPayload;
        const child = activeSearches.get(searchId);
        if (child) {
            child.kill("SIGTERM");
            activeSearches.delete(searchId);
        }
        return {};
    });

    router.register(MSG.SEARCH_REPLACE, async (payload) => {
        const p = payload as SearchReplacePayload;
        await assertWorkspacePath(taskStore, p.path);
        await assertMutableWorkspacePath(taskStore, p.filePath);

        // Inserted as typed: the UI shifts the line's later matches by the
        // typed replacement's length, which `$` expansion would change.
        const replacedCount = await replaceInFile(p.filePath, p.replacement, p.matches, null);
        return { replacedCount } satisfies SearchReplaceResponse;
    });

    router.register(MSG.SEARCH_REPLACE_ALL, async (payload) => {
        const p = payload as SearchReplaceAllPayload;
        await assertWorkspacePath(taskStore, p.path);

        const args = buildRgArgs({
            path: p.path,
            query: p.query,
            caseSensitive: p.caseSensitive,
            wholeWord: p.wholeWord,
            useRegex: p.useRegex,
            includePattern: p.includePattern,
            excludePattern: p.excludePattern,
        });

        const searchResult = await new Promise<{ files: SearchFileResult[] }>((resolve) => {
            const child = spawn(getRgPath(), args, {
                env: { ...process.env, PATH: buildShellPath() },
                stdio: ["ignore", "pipe", "pipe"],
            });

            const chunks: Buffer[] = [];
            child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));

            child.on("close", () => {
                const stdout = Buffer.concat(chunks).toString("utf-8");
                resolve(parseRgOutput(stdout));
            });

            child.on("error", () => resolve({ files: [] }));
        });

        const filesToProcess = p.filePath
            ? searchResult.files.filter((f) => f.path === p.filePath)
            : searchResult.files;

        const regex = p.useRegex ? buildReplaceRegex(p.query, p.caseSensitive) : null;
        let totalReplaced = 0;
        let filesModified = 0;

        for (const file of filesToProcess) {
            await assertMutableWorkspacePath(taskStore, file.path);
            const count = await replaceInFile(file.path, p.replacement, file.matches, regex);
            if (count > 0) {
                totalReplaced += count;
                filesModified++;
            }
        }

        return { replacedCount: totalReplaced, filesModified } satisfies SearchReplaceAllResponse;
    });
}
