import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GIT_LOG_MAX_LIMIT, MSG } from "@taskflow/shared";
import type { GitLogEntry, GitLogPayload, Project } from "@taskflow/shared";
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
    server = startTestServer("git", (type, payload) => {
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
        if (type === MSG.GIT_LOG) {
            // Paged and clamped as the backend handler does
            const { limit = 100, skip = 0 } = payload as GitLogPayload;
            const end = skip + Math.min(limit, GIT_LOG_MAX_LIMIT);
            return { entries: repo.log.slice(skip, end), hasMore: repo.log.length > end };
        }
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

test("a History refresh keeps every loaded commit past one read's limit", async () => {
    repo.log = Array.from({ length: 650 }, (_, index) => commit(`c${index}`));
    await mount(<HistoryPane repoPath="/repo" changeTarget={project.id} />);
    const rows = () => container?.querySelectorAll('div[role="button"][tabindex="0"]').length ?? 0;
    await until(() => rows() === 100);
    for (let loaded = 200; loaded <= 600; loaded += 100) {
        const more = [...(container?.querySelectorAll("button") ?? [])].find(
            (b) => b.textContent?.trim() === "Load more",
        );
        await act(async () => more?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
        await until(() => rows() === loaded);
    }

    repo.log = [commit("new"), ...repo.log];
    server?.broadcast(MSG.GIT_CHANGE_STATS, { targetId: project.id, stats: null });
    await until(() => !!container?.textContent?.includes("new"));
    expect(rows()).toBe(600);
});

test("Enter on a Changes row's button is left to the button, not the row", async () => {
    await mount(<ChangesPane repoPath="/repo" changeTarget={project.id} />);
    await until(() => !!container?.textContent?.includes("a.ts"));

    const stage = container?.querySelector('button[aria-label="Stage file"]');
    const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => stage?.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    expect(server?.received.some((r) => r.type === MSG.GIT_DIFF_FILE_CONTENT)).toBe(false);

    // Enter on the row itself still opens the diff
    const row = stage?.closest('div[role="button"]');
    await act(async () =>
        row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    await until(() => !!server?.received.some((r) => r.type === MSG.GIT_DIFF_FILE_CONTENT));
});
