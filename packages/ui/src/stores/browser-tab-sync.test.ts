import { expect, test } from "bun:test";
import type { BrowserTab, BrowserTabScope } from "@taskflow/shared";
import { syncBrowserTabs } from "./browser-tab-sync";
import type { Tab } from "./session-helpers";

const tab = (id: string, scope: BrowserTabScope = { kind: "task", taskId: "t" }): BrowserTab => ({
    id,
    scope,
    label: id,
    url: "https://example.com",
    createdAt: "2026-10-30T00:00:00Z",
    loaded: true,
    agentConnections: 0,
});
const keyFor = (scope: BrowserTabScope) =>
    scope.kind === "task"
        ? `task:${scope.taskId}`
        : scope.kind === "project"
          ? `project:${scope.projectId}`
          : "master";
const empty = () => ({
    tabsByWorkspace: {} as Record<string, Tab[]>,
    activeTabByWorkspace: {} as Record<string, string>,
});
const sync = (
    state = empty(),
    tabs: BrowserTab[] = [tab("a")],
    knownIds = new Set<string>(),
    initial = false,
) => syncBrowserTabs(state, { tabs, knownIds, initial, workspaceKeyFor: keyFor });

test("adds registry tabs to their task, project and master workspaces", () => {
    const state = sync(empty(), [
        tab("a"),
        tab("b", { kind: "project", projectId: "p" }),
        tab("c", { kind: "master" }),
    ]);
    expect(Object.keys(state.tabsByWorkspace)).toEqual(["task:t", "project:p", "master"]);
    expect(state.tabsByWorkspace["task:t"][0]).toMatchObject({
        id: "browser:a",
        browserTabId: "a",
        type: "browser",
        label: "a",
        url: "https://example.com",
    });
});
test("ignores master tabs when workspaceKeyFor returns null", () => {
    const state = empty();
    expect(
        syncBrowserTabs(state, {
            tabs: [tab("m", { kind: "master" })],
            knownIds: new Set(),
            initial: false,
            workspaceKeyFor: () => null,
        }),
    ).toBe(state);
});
test("initial sync activates nothing", () => {
    expect(sync(empty(), [tab("a")], new Set(), true).activeTabByWorkspace).toEqual({});
});
test("a new id after initial becomes the active tab of its workspace", () => {
    const state = sync(empty(), [tab("a")], new Set(), true);
    expect(sync(state, [tab("a"), tab("b")], new Set(["a"])).activeTabByWorkspace["task:t"]).toBe(
        "browser:b",
    );
});
test("removes tabs whose browserTabId left the list and falls back the active tab", () => {
    const state = sync(empty(), [tab("a"), tab("b")]);
    const result = sync(state, [tab("a")], new Set(["a", "b"]));
    expect(result.tabsByWorkspace["task:t"].map((t) => t.id)).toEqual(["browser:a"]);
    expect(result.activeTabByWorkspace["task:t"]).toBe("browser:a");
    expect(sync(result, [], new Set(["a"])).activeTabByWorkspace["task:t"]).toBe("");
});
test("keeps a tab in the right pane where the user moved it", () => {
    const state = sync();
    const moved = {
        ...state,
        tabsByWorkspace: { "task:t": [], "task:t:right": state.tabsByWorkspace["task:t"] },
    };
    const result = sync(moved, [{ ...tab("a"), title: "Changed" }], new Set(["a"]));
    expect(result.tabsByWorkspace["task:t"]).toEqual([]);
    expect(result.tabsByWorkspace["task:t:right"][0].label).toBe("Changed");
});
test("refreshes label from title and the agent marker", () => {
    const state = sync();
    const next = sync(
        state,
        [{ ...tab("a"), title: "Title", agentConnections: 1, url: "https://new.test" }],
        new Set(["a"]),
    );
    expect(next.tabsByWorkspace["task:t"][0]).toMatchObject({
        label: "Title",
        agentConnected: true,
        url: "https://new.test",
    });
    expect(
        sync(next, [tab("a")], new Set(["a"])).tabsByWorkspace["task:t"][0].agentConnected,
    ).toBeUndefined();
});
test("returns the same state object when nothing changed", () => {
    const state = sync();
    expect(sync(state, [tab("a")], new Set(["a"]))).toBe(state);
    const next = sync(
        state,
        [tab("a"), tab("p", { kind: "project", projectId: "p" })],
        new Set(["a"]),
    );
    expect(next.tabsByWorkspace["task:t"]).toBe(state.tabsByWorkspace["task:t"]);
});
test("leaves legacy browser tabs (no browserTabId) alone", () => {
    const state = {
        ...empty(),
        tabsByWorkspace: {
            "task:t": [{ id: "legacy", type: "browser" as const, label: "Legacy" }],
        },
    };
    expect(sync(state, [], new Set(["legacy"]))).toBe(state);
});
test("an empty list from another backend removes nothing", () => {
    const state = sync();
    expect(sync(state, [], new Set())).toBe(state);
});
test("a reset of one backend removes only its tabs", () => {
    const state = sync(empty(), [tab("a"), tab("b", { kind: "project", projectId: "p" })]);
    const result = sync(state, [], new Set(["a"]));
    expect(result.tabsByWorkspace["task:t"]).toEqual([]);
    expect(result.tabsByWorkspace["project:p"]).toBe(state.tabsByWorkspace["project:p"]);
});
