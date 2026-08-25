import { describe, expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { GitStatusResult } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { GitChange } from "./model";
import { GitStore } from "./store";

const emptyStatus: GitStatusResult = {
    branch: "main",
    ahead: 0,
    behind: 0,
    stagedFiles: [],
    unstagedFiles: [],
};
const stagedChange: GitChange = {
    key: "staged:file.ts",
    group: "staged",
    path: "file.ts",
    status: "modified",
    staged: true,
};

function fakeNet(): NetLike & {
    requests: Array<{ type: string; payload: unknown }>;
    resolve(type: string, index: number, value: unknown): void;
    emit(type: string, payload: unknown): void;
} {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const pending = new Map<string, Array<(value: unknown) => void>>();
    const requests: Array<{ type: string; payload: unknown }> = [];
    return {
        requests,
        request<T>(type: string, payload?: unknown): Promise<T> {
            requests.push({ type, payload });
            return new Promise<T>((resolve) => {
                const queue = pending.get(type) ?? [];
                queue.push(resolve as (value: unknown) => void);
                pending.set(type, queue);
            });
        },
        on(type, handler) {
            const set = listeners.get(type) ?? new Set();
            set.add(handler);
            listeners.set(type, set);
            return () => set.delete(handler);
        },
        onStatusChange: () => () => undefined,
        resolve(type, index, value) {
            pending.get(type)?.[index]?.(value);
        },
        emit(type, payload) {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
    };
}

describe("GitStore", () => {
    test("ignores late status and diff responses from a previous repository", async () => {
        const net = fakeNet();
        const store = new GitStore(net);
        const oldStatus = store.loadStatus("/old", "old-id");
        const newStatus = store.loadStatus("/new", "new-id");
        net.resolve(MSG.GIT_STATUS, 1, { status: { ...emptyStatus, branch: "new" } });
        await newStatus;
        net.resolve(MSG.GIT_STATUS, 0, { status: { ...emptyStatus, branch: "old" } });
        await oldStatus;
        expect(store.path).toBe("/new");
        expect(store.status?.branch).toBe("new");

        const oldDiff = store.loadDiff(stagedChange);
        const switchStatus = store.loadStatus("/third", "third-id");
        net.resolve(MSG.GIT_STATUS, 2, { status: emptyStatus });
        await switchStatus;
        net.resolve(MSG.GIT_DIFF_FILE, 0, { staged: "old diff" });
        await oldDiff;
        expect(store.diff).toBeNull();
        store.dispose();
    });

    test("loads the requested staged side and refreshes matching change events", async () => {
        const net = fakeNet();
        const store = new GitStore(net);
        const load = store.loadStatus("/repo", "task-id");
        net.resolve(MSG.GIT_STATUS, 0, {
            status: { ...emptyStatus, stagedFiles: [stagedChange] },
        });
        await load;
        const diff = store.loadDiff(stagedChange);
        net.resolve(MSG.GIT_DIFF_FILE, 0, { staged: "@@ staged", unstaged: "@@ unstaged" });
        await diff;
        expect(store.diff?.text).toBe("@@ staged");

        net.emit(MSG.GIT_CHANGE_STATS, { targetId: "other", stats: null });
        expect(net.requests.filter((request) => request.type === MSG.GIT_STATUS)).toHaveLength(1);
        net.emit(MSG.GIT_CHANGE_STATS, { targetId: "task-id", stats: null });
        expect(net.requests.filter((request) => request.type === MSG.GIT_STATUS)).toHaveLength(2);
        net.resolve(MSG.GIT_STATUS, 1, { status: emptyStatus });
        await Promise.resolve();
        store.dispose();
    });

    test("never generates implicitly and rejects invalid commits before requesting", async () => {
        const net = fakeNet();
        const store = new GitStore(net);
        const load = store.loadStatus("/repo", "p1");
        net.resolve(MSG.GIT_STATUS, 0, { status: emptyStatus });
        await load;
        expect(net.requests.some((request) => request.type === MSG.GIT_GENERATE_COMMIT_MSG)).toBe(
            false,
        );
        await expect(store.commit("  ")).rejects.toThrow("Commit message is required");
        await expect(store.commit("message")).rejects.toThrow("Stage a file before committing");
        await expect(store.generateMessage()).rejects.toThrow("Stage a file before generating");
        expect(net.requests).toHaveLength(1);
        store.dispose();
    });

    test("stages, commits without push, and refreshes after each mutation", async () => {
        const net = fakeNet();
        const store = new GitStore(net);
        const load = store.loadStatus("/repo", "p1");
        net.resolve(MSG.GIT_STATUS, 0, {
            status: { ...emptyStatus, unstagedFiles: [{ ...stagedChange, staged: false }] },
        });
        await load;
        const staging = store.stage({ ...stagedChange, staged: false, group: "unstaged", key: "unstaged:file.ts" });
        net.resolve(MSG.GIT_STAGE, 0, { success: true });
        await Promise.resolve();
        net.resolve(MSG.GIT_STATUS, 1, {
            status: { ...emptyStatus, stagedFiles: [stagedChange] },
        });
        await staging;

        const committing = store.commit("  commit staged  ");
        net.resolve(MSG.GIT_COMMIT, 0, { hash: "abc", message: "commit staged" });
        await Promise.resolve();
        net.resolve(MSG.GIT_STATUS, 2, { status: emptyStatus });
        expect(await committing).toEqual({ hash: "abc", message: "commit staged" });
        expect(net.requests.find((request) => request.type === MSG.GIT_COMMIT)?.payload).toEqual({
            path: "/repo",
            message: "commit staged",
            push: false,
            includeUnstaged: false,
        });
        store.dispose();
    });
});
