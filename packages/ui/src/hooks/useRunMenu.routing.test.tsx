import { afterAll, beforeAll, expect, test } from "bun:test";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MSG } from "@taskflow/shared";
import type { ShellListResponse } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { resetBackend } from "@/stores/store-reset";
import { useRunMenu } from "./useRunMenu";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const shells: ShellListResponse = {
    shells: [{ name: "zsh", path: "/bin/zsh" }],
    systemShellPath: "/bin/zsh",
};

/** A machine holding project `p` at `/repos/p`, as both would for one checkout. */
function startMachine(label: string): TestServer {
    return startTestServer(label, (type) => {
        if (type === MSG.SCRIPTS_LIST) return { scripts: { dev: `${label} dev` } };
        if (type === MSG.AGENT_COMMANDS_LIST) return { commands: [] };
        if (type === MSG.SHELLS_LIST) return shells;
        if (type === MSG.SESSION_CREATE) return { sessionId: `session-${label}` };
        if (type === MSG.PROJECT_LIST) return { projects: [] };
        if (type === MSG.TASK_LIST) return { tasks: [] };
        if (type === MSG.FLOW_DEFINITIONS_LIST) return { flows: [] };
        if (type === MSG.FLOW_ACTIONS_LIST) return { actions: [] };
        if (type === MSG.AGENTS_LIST) return { agents: [] };
        return {};
    });
}

async function until(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the request");
        await Bun.sleep(10);
    }
}

let a: TestServer;
let b: TestServer;
let root: Root;
let menu: ReturnType<typeof useRunMenu> | null = null;

function Probe() {
    const result = useRunMenu({
        backendId: "b",
        projectId: "p",
        projectPath: "/repos/p",
        showAgentOptions: false,
        enabled: true,
    });
    useEffect(() => {
        menu = result;
    }, [result]);
    return null;
}

beforeAll(async () => {
    a = startMachine("a");
    b = startMachine("b");
    await openConnection("a", a.origin);
    await openConnection("b", b.origin);
    setPrimary("a");
    root = createRoot(document.createElement("div"));
});

afterAll(async () => {
    await act(async () => root.unmount());
    for (const id of ["a", "b"]) {
        closeConnection(id, "detach");
        resetBackend(id);
    }
    a.stop();
    b.stop();
});

const typesAt = (server: TestServer) => server.received.map((r) => r.type);

test("a run menu for another machine's project asks that machine, and only it", async () => {
    await act(async () => root.render(<Probe />));
    await act(() =>
        until(
            () =>
                typesAt(b).includes(MSG.SCRIPTS_LIST) &&
                typesAt(b).includes(MSG.AGENT_COMMANDS_LIST),
        ),
    );
    await act(() => until(() => menu?.data.scripts.dev === "b dev"));

    expect(typesAt(a)).toEqual([]);
});

test("a script run from that menu starts its shell on the project's machine", async () => {
    await act(async () => menu?.callbacks.onRunScript("dev"));
    await act(() => until(() => typesAt(b).includes(MSG.SESSION_INPUT)));

    expect(typesAt(b)).toContain(MSG.SHELLS_LIST);
    expect(typesAt(b)).toContain(MSG.SESSION_CREATE);
    expect(typesAt(a)).toEqual([]);
});
