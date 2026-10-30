import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { GitCheckPrResult, Task } from "@taskflow/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useTaskStore } from "./task-store";
import { useSidebarData } from "@/components/sidebar/hooks/useSidebarData";
import { MSG } from "@taskflow/shared";
import { usePullRequestStore, pullRequestKey } from "./pull-request-store";
import { startTestServer } from "@/lib/test-ws-server";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { resetBackend } from "./store-reset";

// @ts-expect-error React act test flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const found = (number: number, state: "open" | "merged" | "closed" = "open"): GitCheckPrResult => ({
    status: "found",
    provider: "gitlab",
    pr: {
        number,
        url: `https://gitlab.com/g/r/-/merge_requests/${number}`,
        provider: "gitlab",
        state,
    },
});
const unavailable: GitCheckPrResult = {
    status: "unavailable",
    provider: "gitlab",
    pr: null,
    reason: "failed",
    message: "Merge request status is unavailable",
};
const savedTask: Task = {
    id: "saved-task",
    projectId: "project",
    title: "Saved",
    description: "",
    notes: "",
    sessions: [],
    attributes: [],
    createdAt: "2026-10-31T00:00:00Z",
    status: "active",
    archivedAt: null,
    pinned: false,
    worktree: {
        enabled: true,
        path: "/repo",
        branch: "topic",
        pr: { number: 4, url: "https://gitlab.com/mr/4", provider: "gitlab", state: "open" },
    },
};
let answer: GitCheckPrResult = found(1);
let hold: Promise<void> | null = null;
const desktop = startTestServer("pr-desktop", (type, payload) => {
    if (type === MSG.TASK_LIST) return { tasks: [savedTask] };
    if (type === MSG.TASK_UPDATE) return { ...savedTask, ...(payload as Partial<Task>) };
    if (type !== MSG.GIT_CHECK_PR) return {};
    const result = answer;
    return hold ? hold.then(() => result) : result;
});
const laptop = startTestServer("pr-laptop", () => found(2));
const check = (id = "pr-desktop", branch = "topic") =>
    usePullRequestStore.getState().check(id, "/repo", branch);
const key = (id = "pr-desktop", branch = "topic") => pullRequestKey(id, "/repo", branch);
async function received() {
    for (let i = 0; i < 100 && !desktop.received.length; i++) await Bun.sleep(5);
    expect(desktop.received).toHaveLength(1);
}
beforeAll(async () => {
    await openConnection("pr-desktop", desktop.origin);
    await openConnection("pr-laptop", laptop.origin);
});
beforeEach(() => {
    resetBackend("pr-desktop");
    resetBackend("pr-laptop");
    desktop.received.length = 0;
    laptop.received.length = 0;
    answer = found(1);
    hold = null;
});
afterAll(() => {
    for (const id of ["pr-desktop", "pr-laptop"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    desktop.stop();
    laptop.stop();
});
test("the same repository on two backends has independent MR status", async () => {
    await Promise.all([check(), check("pr-laptop")]);
    expect(usePullRequestStore.getState().byKey[key()]).toEqual(found(1));
    expect(usePullRequestStore.getState().byKey[key("pr-laptop")]).toEqual(found(2));
    expect(key()).toBe(JSON.stringify(["pr-desktop", "/repo", "topic"]));
});
test("concurrent checks share one request", async () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    const a = check();
    const b = check();
    expect(a).toBe(b);
    await received();
    release();
    expect(await a).toEqual(await b);
    expect(desktop.received).toHaveLength(1);
});
test("unavailable never overwrites saved request metadata", async () => {
    // Exercise the consumer that persists status, including tasks with saved links.
    answer = unavailable;
    await useTaskStore.getState().fetchTasks("pr-desktop");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Sidebar() {
        useSidebarData(true);
        return null;
    }
    try {
        await act(async () => {
            root.render(createElement(Sidebar));
        });
        for (let i = 0; i < 100 && !usePullRequestStore.getState().byKey[key()]; i++)
            await act(async () => {
                await Bun.sleep(5);
            });
        expect(usePullRequestStore.getState().byKey[key()]).toEqual(unavailable);
        expect(
            useTaskStore.getState().tasks.find((task) => task.id === savedTask.id)?.worktree.pr,
        ).toEqual(savedTask.worktree.pr);
        expect(desktop.received.filter((request) => request.type === MSG.TASK_UPDATE)).toHaveLength(
            0,
        );
    } finally {
        await act(async () => {
            root.unmount();
        });
        container.remove();
    }
});
test("backend reset discards late status results", async () => {
    await check("pr-laptop");
    let release = () => {};
    hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    const late = check();
    await received();
    resetBackend("pr-desktop");
    hold = null;
    answer = found(3);
    await check();
    release();
    await late;
    expect(usePullRequestStore.getState().byKey[key()]).toEqual(found(3));
    expect(usePullRequestStore.getState().byKey[key("pr-laptop")]).toEqual(found(2));
});
test("a later check retries after unavailable", async () => {
    answer = unavailable;
    await check();
    answer = found(3);
    expect(await check()).toEqual(found(3));
    expect(desktop.received).toHaveLength(2);
});
test("closed and merged requests remain distinguishable from none", async () => {
    for (const result of [
        found(4, "closed"),
        found(4, "merged"),
        { status: "none", provider: "gitlab", pr: null } satisfies GitCheckPrResult,
    ]) {
        answer = result;
        expect(await check()).toEqual(result);
    }
});
test("connection failure is unavailable rather than none", async () => {
    expect(await check("missing-machine")).toMatchObject({
        status: "unavailable",
        reason: "failed",
    });
});
test("a late result for another branch remains under that branch key", async () => {
    let release = () => {};
    hold = new Promise<void>((resolve) => {
        release = resolve;
    });
    const late = check();
    await received();
    hold = null;
    answer = found(3);
    await check("pr-desktop", "new-topic");
    release();
    await late;
    expect(usePullRequestStore.getState().byKey[key("pr-desktop", "new-topic")]).toEqual(found(3));
});
