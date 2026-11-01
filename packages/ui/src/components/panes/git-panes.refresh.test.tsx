import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import type { GitLogEntry, Project } from "@taskflow/shared";
import { closeConnection, openConnection } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useProjectStore } from "@/stores/project-store";
import { resetBackend } from "@/stores/store-reset";
import { useUIStore } from "@/stores/ui-store";
import { ChangesPane } from "./ChangesPane";
import { HistoryPane } from "./HistoryPane";

// @ts-expect-error React act test flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const project: Project = {
    id: "p1",
    name: "Repo",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
};

function commit(subject: string): GitLogEntry {
    return {
        hash: subject,
        shortHash: subject,
        subject,
        authorName: "dev",
        date: "2026-11-01T00:00:00.000Z",
        refs: [],
    };
}

/** What the repository holds; requests read it, the test moves it. */
const repo = { unstaged: ["a.ts"], log: [commit("first")] };
let server: TestServer | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(element: React.ReactNode) {
    server = startTestServer("git", (type) => {
        if (type === MSG.GIT_STATUS)
            return {
                status: {
                    branch: "main",
                    stagedFiles: [],
                    unstagedFiles: repo.unstaged.map((path) => ({
                        path,
                        status: "modified",
                        staged: false,
                    })),
                    ahead: 0,
                    behind: 0,
                    hasUpstream: true,
                },
            };
        if (type === MSG.GIT_LOG) return { entries: repo.log, hasMore: false };
        return {};
    });
    await openConnection("git", server.origin);
    useProjectStore.setState({ projects: [{ ...project, backendId: "git" }] });
    useUIStore.setState({ activeProjectId: project.id, masterWorkspaceActive: false });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(element));
}

async function until(predicate: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`timed out: ${container?.textContent}`);
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
}

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    closeConnection("git", "detach");
    resetBackend("git");
    server?.stop();
    server = null;
    repo.unstaged = ["a.ts"];
    repo.log = [commit("first")];
});

test("an open Changes pane follows its repository's change updates", async () => {
    await mount(<ChangesPane repoPath="/repo" changeTarget={project.id} />);
    await until(() => !!container?.textContent?.includes("a.ts"));

    repo.unstaged = ["a.ts", "b.ts"];
    // Another target's update leaves the pane alone
    server?.broadcast(MSG.GIT_CHANGE_STATS, { targetId: "other", stats: null });
    server?.broadcast(MSG.GIT_CHANGE_STATS, { targetId: project.id, stats: null });
    await until(() => !!container?.textContent?.includes("b.ts"));
    expect(server?.received.filter((r) => r.type === MSG.GIT_STATUS)).toHaveLength(2);
});

test("an open History pane lists commits made while it is open", async () => {
    await mount(<HistoryPane repoPath="/repo" changeTarget={project.id} />);
    await until(() => !!container?.textContent?.includes("first"));

    repo.log = [commit("second"), commit("first")];
    server?.broadcast(MSG.GIT_CHANGE_STATS, { targetId: project.id, stats: null });
    await until(() => !!container?.textContent?.includes("second"));
});
