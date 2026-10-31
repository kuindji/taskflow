import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type {
    SearchMatch,
    SearchQueryResponse,
    SearchReplaceAllResponse,
    SearchReplaceResponse,
} from "@taskflow/shared";
import { registerSearchHandlers } from "../../src/handlers/search";
import { TaskStore } from "../../src/services/task-store";
import { TestRouter } from "../test-router";

describe("search handlers", () => {
    let router: TestRouter;
    let tempDir: string;
    let projectDir: string;

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-search-test-")));
        const store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        projectDir = join(tempDir, "project");
        await mkdir(projectDir, { recursive: true });
        await store.addProject({ name: "test", path: projectDir });
        router = new TestRouter();
        registerSearchHandlers({ router, taskStore: store });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    const options = { caseSensitive: true, wholeWord: false, useRegex: false };

    async function search(
        query: string,
        overrides: Partial<typeof options> = {},
    ): Promise<SearchQueryResponse["result"]> {
        const response = (await router.handle(MSG.SEARCH_QUERY, {
            path: projectDir,
            query,
            ...options,
            ...overrides,
        })) as SearchQueryResponse;
        return response.result;
    }

    async function replaceMatch(
        filePath: string,
        query: string,
        match: SearchMatch,
    ): Promise<number> {
        const response = (await router.handle(MSG.SEARCH_REPLACE, {
            path: projectDir,
            filePath,
            query,
            replacement: "x",
            ...options,
            matches: [match],
        })) as SearchReplaceResponse;
        return response.replacedCount;
    }

    it("treats a query without the regex option as literal text", async () => {
        await writeFile(join(projectDir, "a.txt"), "a.b axb [x]\n");

        const dot = await search("a.b");
        expect(dot.totalMatches).toBe(1);
        expect(dot.files[0].matches[0].column).toBe(1);

        const bracket = await search("[");
        expect(bracket.totalMatches).toBe(1);
        expect(bracket.files[0].matches[0].column).toBe(9);
    });

    it("answers a search that matches a line which is not UTF-8", async () => {
        await writeFile(join(projectDir, "latin1.txt"), Buffer.from("caf\xe9 foo\n", "latin1"));

        const result = await search("foo");

        expect(result.totalMatches).toBe(1);
        const match = result.files[0].matches[0];
        expect(match.lineContent).toBe("caf� foo");
        expect(match.column).toBe(6);
        expect(match.matchLength).toBe(3);
    });

    it("leaves a file that is not UTF-8 untouched on replace all", async () => {
        const file = join(projectDir, "latin1.txt");
        const original = Buffer.from("caf\xe9 foo\n", "latin1");
        await writeFile(file, original);

        const response = (await router.handle(MSG.SEARCH_REPLACE_ALL, {
            path: projectDir,
            query: "foo",
            replacement: "bar",
            ...options,
        })) as SearchReplaceAllResponse;

        expect(response.replacedCount).toBe(0);
        expect(Buffer.compare(await readFile(file), original)).toBe(0);
    });

    it("replaces all whole-word regex matches only where the search found them", async () => {
        const file = join(projectDir, "words.txt");
        await writeFile(file, "foo foobar bar xbar\n");

        const response = (await router.handle(MSG.SEARCH_REPLACE_ALL, {
            path: projectDir,
            query: "foo|bar",
            replacement: "X",
            ...options,
            wholeWord: true,
            useRegex: true,
        })) as SearchReplaceAllResponse;

        expect(response.replacedCount).toBe(2);
        expect(await readFile(file, "utf-8")).toBe("X foobar X xbar\n");
    });

    it("refuses coordinates from a line that changed since the search", async () => {
        const file = join(projectDir, "two.txt");
        await writeFile(file, "foo foo tail\n");
        const [first, second] = (await search("foo")).files[0].matches;

        expect(await replaceMatch(file, "foo", first)).toBe(1);
        expect(await replaceMatch(file, "foo", second)).toBe(0);
        expect(await readFile(file, "utf-8")).toBe("x foo tail\n");

        // The same match moved by the first replacement, as the UI shifts it.
        const shifted = { ...second, column: second.column - 2, lineContent: "x foo tail" };
        expect(await replaceMatch(file, "foo", shifted)).toBe(1);
        expect(await readFile(file, "utf-8")).toBe("x x tail\n");
    });

    it("replaces a match on the first line of a file with a BOM and keeps the BOM", async () => {
        const file = join(projectDir, "bom.txt");
        await writeFile(file, "﻿foo bar\r\nfoo\r\n");
        const [match] = (await search("foo")).files[0].matches;

        expect(await replaceMatch(file, "foo", match)).toBe(1);
        expect(await readFile(file, "utf-8")).toBe("﻿x bar\r\nfoo\r\n");
    });
});
