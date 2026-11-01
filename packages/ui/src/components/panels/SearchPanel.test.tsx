import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { useSearchStore } from "@/stores/search-store";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The open workspace's machine; both machines hold a project at /repo. */
const useBackend = create<{ id: string }>(() => ({ id: "desktop" }));
const realActiveWorkspace = await import("@/hooks/useActiveWorkspace");
const workspaceExports = { ...realActiveWorkspace };
await mock.module("@/hooks/useActiveWorkspace", () => ({
    ...workspaceExports,
    useActiveWorkspace: () => ({
        workingDir: "/repo",
        workspaceKey: `project:${useBackend((s) => s.id)}`,
        project: { id: useBackend((s) => s.id) },
        task: null,
    }),
}));
await mock.module("@/hooks/useWorkspaceBackend", () => ({
    useWorkspaceBackend: () => useBackend((s) => s.id),
}));
const opened: { path: string; workspaceKey: string | null }[] = [];
const realOpenFile = await import("@/lib/open-file");
const openFileExports = { ...realOpenFile };
await mock.module("@/lib/open-file", () => ({
    ...openFileExports,
    openFileInApp: (path: string, workspaceKey: string | null) => {
        opened.push({ path, workspaceKey });
        return Promise.resolve();
    },
}));

const { SearchPanel } = await import("./SearchPanel");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    opened.length = 0;
    useBackend.setState({ id: "desktop" });
    // Desktop's results, from a two-letter search run with Enter.
    useSearchStore.setState({
        query: "id",
        results: [
            {
                path: "/repo/src/a.ts",
                matches: [{ line: 7, column: 1, matchLength: 2, lineContent: "const id = 1;" }],
            },
        ],
        totalMatches: 1,
        searchBackendId: "desktop",
        searchRoot: "/repo",
        expandedFiles: new Set(["/repo/src/a.ts"]),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useSearchStore.getState().clear();
});

function clickMatch() {
    const match = [...container.querySelectorAll<HTMLElement>("div.cursor-pointer")].find((row) =>
        row.textContent?.includes("const id = 1;"),
    );
    if (!match) throw new Error("match row not rendered");
    act(() => match.click());
}

test("a result opens in the workspace on the machine it was found on", async () => {
    await act(async () => {
        root.render(<SearchPanel />);
    });
    clickMatch();
    expect(opened).toEqual([{ path: "/repo/src/a.ts", workspaceKey: "project:desktop" }]);
});

test("a result still shown after moving to another machine's workspace does not open there", async () => {
    await act(async () => {
        root.render(<SearchPanel />);
    });
    await act(async () => {
        useBackend.setState({ id: "laptop" });
    });
    clickMatch();
    expect(opened).toEqual([]);
});
