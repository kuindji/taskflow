import { afterAll, afterEach, expect, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG, type GitCheckPrResult, type GitStatusResponse } from "@taskflow/shared";
const originalUserAgent = window.navigator.userAgent;
afterAll(() =>
    Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: originalUserAgent,
    }),
);
// Avoid Monaco's Safari clipboard gesture workaround in happy-dom.
Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36",
});
const { CommitDialogBody } = await import("./CommitDialog");

// @ts-expect-error React act test flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const none: GitCheckPrResult = { status: "none", provider: "gitlab", pr: null };
function fixture(changes = false) {
    const requests: string[] = [];
    const sessions: unknown[][] = [];
    let result: GitCheckPrResult = none;
    let hold: Promise<GitCheckPrResult> | null = null;
    const props: ComponentProps<typeof CommitDialogBody> = {
        open: true,
        onOpenChange: () => {},
        repoPath: "/repo",
        backendId: "gitlab",
        defaultAgent: "claude",
        sessionOwner: { taskId: "task" },
        request: async <T,>(type: string): Promise<T> => {
            requests.push(type);
            if (type === MSG.GIT_STATUS)
                return {
                    status: {
                        branch: "topic",
                        stagedFiles: [],
                        unstagedFiles: changes
                            ? [{ path: "file", status: "modified", staged: false }]
                            : [],
                        ahead: 0,
                        behind: 0,
                    },
                } as GitStatusResponse as T;
            if (type === MSG.BUILTIN_ACTIONS_LIST) return { actions: [] } as T;
            return { message: "commit", hash: "a" } as T;
        },
        checkPr: async () => hold ?? result,
        createSession: async (...args) => {
            sessions.push(args);
            return "session";
        },
    };
    return {
        props,
        requests,
        sessions,
        setResult(value: GitCheckPrResult) {
            result = value;
        },
        setHold(value: Promise<GitCheckPrResult>) {
            hold = value;
        },
    };
}
async function render(props: ComponentProps<typeof CommitDialogBody>) {
    if (!root) {
        container = document.createElement("div");
        document.body.append(container);
        root = createRoot(container);
    }
    await act(async () => {
        root?.render(<CommitDialogBody {...props} />);
    });
}
function button(label: string) {
    const result = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
    );
    if (!result) throw new Error(`No button ${label}: ${document.body.textContent}`);
    return result;
}
async function click(element: Element | null) {
    if (!element) throw new Error("Missing control");
    await act(async () => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}
afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
});
test("GitLab renders Create MR and MR Title", async () => {
    const f = fixture();
    await render(f.props);
    expect(button("Create MR").disabled).toBe(false);
    expect(document.body.textContent).toContain("Create Merge Request");
    expect(document.querySelector('label[for="pr-title"]')?.textContent).toContain("MR Title");
});
test("GitLab agent mode requests a merge request", async () => {
    const f = fixture(true);
    await render(f.props);
    await click(document.querySelector("#commit-use-agent"));
    await click(document.querySelector("#commit-push"));
    await click(document.querySelector("#commit-create-pr"));
    await click(button("Commit & Push"));
    expect(f.sessions).toHaveLength(1);
    expect(f.sessions[0][3]).toContain("Create a merge request after pushing.");
    expect(f.requests).not.toContain(MSG.GIT_CREATE_PR);
});
test("a failed lookup shows unavailable and preserves commit controls", async () => {
    const f = fixture(true);
    f.setResult({
        status: "unavailable",
        provider: "gitlab",
        pr: null,
        reason: "failed",
        message: "Merge request status is unavailable",
    });
    await render(f.props);
    expect(document.body.textContent).toContain("Merge request status is unavailable");
    expect(button("Commit").disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>("#commit-create-pr")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Create MR");
    f.setResult(none);
    await click(button("Retry"));
    expect(document.body.textContent).not.toContain("Merge request status is unavailable");
    expect(f.requests).not.toContain(MSG.GIT_CREATE_PR);
});
test("request creation stays disabled until provider lookup completes", async () => {
    const f = fixture();
    let resolve = (_: GitCheckPrResult) => {};
    f.setHold(
        new Promise((r) => {
            resolve = r;
        }),
    );
    await render(f.props);
    expect(button("Create Request").disabled).toBe(true);
    await act(async () => {
        resolve(none);
    });
    expect(button("Create MR").disabled).toBe(false);
});
test("a stale GitHub response cannot relabel a new GitLab repository", async () => {
    const old = fixture();
    let resolve = (_: GitCheckPrResult) => {};
    old.setHold(
        new Promise((r) => {
            resolve = r;
        }),
    );
    await render({ ...old.props, backendId: "github" });
    const next = fixture();
    await render({ ...next.props, repoPath: "/new-repo" });
    await act(async () => {
        resolve({ status: "none", provider: "github", pr: null });
    });
    expect(button("Create MR").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Create PR");
});
for (const [reason, message] of [
    ["cli-missing", "GitLab CLI is not installed"],
    [
        "not-authenticated",
        "GitLab CLI is not authenticated for gitlab.com. Run glab auth login --hostname gitlab.com",
    ],
    ["failed", "Merge request status is unavailable"],
] as const) {
    test(`${reason} acceptance offers Retry without creating a request`, async () => {
        const f = fixture();
        f.setResult({ status: "unavailable", provider: "gitlab", pr: null, reason, message });
        await render(f.props);
        expect(document.body.textContent).toContain(message);
        expect(button("Create MR").disabled).toBe(true);
        f.setResult(none);
        await click(button("Retry"));
        expect(button("Create MR").disabled).toBe(false);
        expect(f.requests).not.toContain(MSG.GIT_CREATE_PR);
    });
}
for (const [provider, state, number, text] of [
    ["github", "open", 3, "PR #3 open"],
    ["gitlab", "open", 4, "MR !4 open"],
    ["gitlab", "merged", 5, "MR !5 merged"],
] as const) {
    test(`${text} acceptance preserves existing request and disables creation`, async () => {
        const f = fixture();
        f.setResult({
            status: "found",
            provider,
            pr: { provider, state, number, url: `https://example.com/request/${number}` },
        });
        await render(f.props);
        expect(document.body.textContent).toContain(text);
        expect(button(provider === "gitlab" ? "Create MR" : "Create PR").disabled).toBe(true);
    });
}
test("switching remote machines at the same repo path discards the old answer", async () => {
    const old = fixture();
    let resolve = (_: GitCheckPrResult) => {};
    old.setHold(
        new Promise((r) => {
            resolve = r;
        }),
    );
    await render({ ...old.props, backendId: "github" });
    const next = fixture();
    await render(next.props);
    await act(async () => {
        resolve({ status: "none", provider: "github", pr: null });
    });
    expect(button("Create MR").disabled).toBe(false);
});

test("legacy saved request renders as GitHub open without a migration", async () => {
    const { TaskHeader } = await import("./TaskHeader");
    const task: NonNullable<ComponentProps<typeof TaskHeader>["task"]> = {
        backendId: "legacy-machine",
        id: "task",
        projectId: "project",
        title: "Legacy",
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
            pr: { number: 9, url: "https://github.com/g/r/pull/9" },
        },
    };
    const project: NonNullable<ComponentProps<typeof TaskHeader>["project"]> = {
        backendId: task.backendId,
        id: "project",
        name: "Repo",
        path: "/repo",
        sessions: [],
        attributes: [],
        createdAt: task.createdAt,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<TaskHeader task={task} project={project} />);
    });
    expect(document.body.textContent).toContain("PR #9 open");
    expect(task.worktree.pr).toEqual({ number: 9, url: "https://github.com/g/r/pull/9" });
});

test("found request links use Electron's external browser opener", async () => {
    const opened: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(window, "taskflow");
    Object.defineProperty(window, "taskflow", {
        configurable: true,
        value: {
            openExternalUrl: async (url: string) => {
                opened.push(url);
            },
        },
    });
    try {
        const f = fixture();
        const url = "https://gitlab.com/group/repo/-/merge_requests/8";
        f.setResult({
            status: "found",
            provider: "gitlab",
            pr: { number: 8, url, provider: "gitlab", state: "open" },
        });
        await render(f.props);
        const link = document.querySelector(`a[href="${url}"]`);
        // Prevent happy-dom navigation while preserving real React click handling.
        link?.addEventListener("click", (event) => event.preventDefault(), { once: true });
        await click(link);
        expect(opened).toEqual([url]);
    } finally {
        if (descriptor) Object.defineProperty(window, "taskflow", descriptor);
        else Reflect.deleteProperty(window, "taskflow");
    }
});
