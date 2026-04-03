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
import { assertWorkspacePath } from "../utils/path-validation";
import { readFile, writeFile } from "fs/promises";
import { spawn, type ChildProcess } from "child_process";
import { buildShellPath } from "../services/shell-path";
import { randomUUID } from "crypto";

interface SearchHandlerDeps {
    router: Router;
    taskStore: TaskStore;
}

const activeSearches = new Map<string, ChildProcess>();

function buildRgArgs(payload: SearchQueryPayload): string[] {
    const args = ["--json", "--line-number", "--column"];

    if (!payload.caseSensitive) {
        args.push("--ignore-case");
    }
    if (payload.wholeWord) {
        args.push("--word-regexp");
    }
    if (payload.useRegex) {
        args.push("--pcre2");
    }
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

interface RgMatchData {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    submatches: Array<{ start: number; end: number }>;
}

function parseRgOutput(stdout: string): { files: SearchFileResult[]; totalMatches: number } {
    const fileMap = new Map<string, SearchMatch[]>();
    let totalMatches = 0;

    for (const line of stdout.split("\n")) {
        if (!line) continue;
        let parsed: { type: string; data: RgMatchData };
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (parsed.type !== "match") continue;

        const data = parsed.data;
        const filePath = data.path.text;
        const lineContent = data.lines.text.replace(/\n$/, "");

        if (!fileMap.has(filePath)) {
            fileMap.set(filePath, []);
        }
        const matches = fileMap.get(filePath)!;

        for (const sub of data.submatches) {
            matches.push({
                line: data.line_number,
                column: sub.start + 1,
                matchLength: sub.end - sub.start,
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

function buildSearchRegex(query: string, caseSensitive: boolean, wholeWord: boolean, useRegex: boolean): RegExp {
    let pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) {
        pattern = `\\b${pattern}\\b`;
    }
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
}

async function replaceInFile(
    filePath: string,
    query: string,
    replacement: string,
    caseSensitive: boolean,
    wholeWord: boolean,
    useRegex: boolean,
    matchFilter?: SearchMatch[],
): Promise<number> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    let replacedCount = 0;

    if (matchFilter && matchFilter.length > 0) {
        const sorted = [...matchFilter].sort((a, b) =>
            a.line !== b.line ? b.line - a.line : b.column - a.column,
        );
        for (const match of sorted) {
            const lineIdx = match.line - 1;
            if (lineIdx < 0 || lineIdx >= lines.length) continue;
            const line = lines[lineIdx];
            const colIdx = match.column - 1;
            if (colIdx < 0 || colIdx > line.length) continue;
            lines[lineIdx] =
                line.slice(0, colIdx) +
                replacement +
                line.slice(colIdx + match.matchLength);
            replacedCount++;
        }
    } else {
        const regex = buildSearchRegex(query, caseSensitive, wholeWord, useRegex);
        for (let i = 0; i < lines.length; i++) {
            const original = lines[i];
            lines[i] = original.replace(regex, replacement);
            regex.lastIndex = 0;
            const matches = original.match(regex);
            if (matches) replacedCount += matches.length;
        }
    }

    if (replacedCount > 0) {
        await writeFile(filePath, lines.join("\n"), "utf-8");
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
            const child = spawn("rg", args, {
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

        const replacedCount = await replaceInFile(
            p.filePath,
            p.query,
            p.replacement,
            p.caseSensitive,
            p.wholeWord,
            p.useRegex,
            p.matches,
        );
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
            const child = spawn("rg", args, {
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

        let totalReplaced = 0;
        let filesModified = 0;

        for (const file of filesToProcess) {
            const count = await replaceInFile(
                file.path,
                p.query,
                p.replacement,
                p.caseSensitive,
                p.wholeWord,
                p.useRegex,
            );
            if (count > 0) {
                totalReplaced += count;
                filesModified++;
            }
        }

        return { replacedCount: totalReplaced, filesModified } satisfies SearchReplaceAllResponse;
    });
}
