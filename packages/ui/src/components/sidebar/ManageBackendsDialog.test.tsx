import { useBackendStore } from "@/stores/backend-store";
import { PROTOCOL_VERSION, MSG } from "@taskflow/shared";
import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { MenuEntry } from "@taskflow/shared";
import { ManageBackendsDialog } from "./ManageBackendsDialog";
import { clearEditorDirty, setEditorDirty } from "@/components/panes/editor-dirty-state";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Bridge = NonNullable<Window["taskflow"]>;

const originalBridge = window.taskflow;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    window.taskflow = originalBridge;
});

const desktop: MenuEntry = {
    id: "desktop-uid",
    displayName: "Desktop",
    instanceId: "main",
    host: "desktop.lan",
    attached: false,
    saved: true,
    seen: false,
    user: "me",
    sshPort: 22,
};

function typeInto(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a cleared SSH port is refused, not saved as a no-op that leaves the row unsaved", async () => {
    const updates: string[] = [];
    const bridge: Pick<Bridge, "listBackends" | "onBackendsChanged" | "updateBackend"> = {
        listBackends: () => Promise.resolve([desktop]),
        onBackendsChanged: () => () => {},
        updateBackend: (id) => {
            updates.push(id);
            return Promise.resolve({ ok: true });
        },
    };
    window.taskflow = bridge as Bridge;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<ManageBackendsDialog open onOpenChange={() => {}} />);
        await Bun.sleep(10);
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });

    const port = document.querySelector<HTMLInputElement>("input[aria-label='SSH port']");
    if (!port) throw new Error("no SSH port field");
    await act(async () => typeInto(port, ""));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => {
        save?.click();
        await Bun.sleep(10);
    });

    expect(updates).toEqual([]);
    expect(document.body.textContent).toContain("The SSH port must be a whole number");
});

async function mountTokenDialog() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<ManageBackendsDialog open onOpenChange={() => {}} />);
        await Bun.sleep(10);
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return document.querySelector<HTMLInputElement>('input[aria-label="Access token"]');
}
async function saveTokenDialog(input: HTMLInputElement | null, value: string) {
    if (!input) throw new Error("no Access token field");
    await act(async () => typeInto(input, value));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => {
        save?.click();
        await Bun.sleep(20);
    });
}
test("editing the access token sends it; emptying it sends null", async () => {
    const patches: unknown[] = [];
    window.taskflow = {
        listBackends: async () => [{ ...desktop, token: "a".repeat(43) }],
        onBackendsChanged: () => () => {},
        updateBackend: async (_id: string, patch: Parameters<Bridge["updateBackend"]>[1]) => {
            patches.push(patch);
            return { ok: true };
        },
    } as unknown as Bridge;
    const input = await mountTokenDialog();
    await saveTokenDialog(input, "b".repeat(43));
    await saveTokenDialog(input, "");
    expect(patches).toEqual([
        expect.objectContaining({ token: "b".repeat(43) }),
        expect.objectContaining({ token: null }),
    ]);
});
test("saving a new token for a machine rejected as unauthorized reattaches it", async () => {
    const token = "b".repeat(43);
    let calls = 0;
    const server = Bun.serve<{ accepted: boolean }>({
        port: 0,
        hostname: "127.0.0.1",
        fetch: (req, s) =>
            s.upgrade(req, {
                data: {
                    accepted: req.headers.get("sec-websocket-protocol")?.includes(token) ?? false,
                },
            })
                ? undefined
                : new Response("ok"),
        websocket: {
            open(ws) {
                if (!ws.data.accepted) ws.close(4401, "unauthorized");
            },
            message(ws, raw) {
                if (!ws.data.accepted) return;
                const r = JSON.parse(String(raw)) as { type: string; correlationId: string };
                const payload =
                    r.type === MSG.SYSTEM_INFO
                        ? { protocolVersion: PROTOCOL_VERSION }
                        : r.type === MSG.PROJECT_LIST
                          ? { projects: [] }
                          : r.type === MSG.TASK_LIST
                            ? { tasks: [] }
                            : {};
                ws.send(JSON.stringify({ correlationId: r.correlationId, payload }));
            },
        },
    });
    const oldState = useBackendStore.getState();
    useBackendStore.setState({
        machines: [
            {
                ...desktop,
                state: "offline",
                isLocal: false,
                keepAttached: true,
                failure: {
                    kind: "unauthorized",
                    message: "Remote backend rejected the access token",
                    stderr: "",
                },
            },
        ],
    });
    cleanups.push(() => {
        void useBackendStore.getState().detach(desktop.id);
        useBackendStore.setState(oldState);
        void server.stop(true);
    });
    window.taskflow = {
        listBackends: async () => [desktop],
        onBackendsChanged: () => () => {},
        updateBackend: async () => ({ ok: true }),
        getAttached: async () => [],
        detachBackend: async () => {},
        refreshBackendToken: async () => ({ ok: true }),
        attachBackend: async () => ({
            ok: true,
            origin: `http://127.0.0.1:${server.port}`,
            token: ++calls === 1 ? "a".repeat(43) : token,
        }),
    } as unknown as Bridge;
    const input = await mountTokenDialog();
    await saveTokenDialog(input, token);
    await act(async () => {
        const deadline = Date.now() + 2000;
        while (
            useBackendStore.getState().machines[0]?.state !== "attached" &&
            Date.now() < deadline
        )
            await Bun.sleep(10);
    });
    expect(useBackendStore.getState().machines[0]?.state).toBe("attached");
    expect(calls).toBe(2);
});
test("saving only a new name does not retry an unauthorized machine", async () => {
    let retries = 0;
    const previous = useBackendStore.getState();
    useBackendStore.setState({
        machines: [
            {
                ...desktop,
                state: "offline",
                isLocal: false,
                keepAttached: true,
                failure: { kind: "unauthorized", message: "rejected", stderr: "" },
            },
        ],
        retry: () => {
            retries++;
        },
    });
    cleanups.push(() => useBackendStore.setState(previous));
    window.taskflow = {
        listBackends: async () => [desktop],
        onBackendsChanged: () => () => {},
        updateBackend: async () => ({ ok: true }),
    } as unknown as Bridge;
    await mountTokenDialog();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Name"]');
    await saveTokenDialog(input, "Renamed");
    expect(retries).toBe(0);
});
test("removing a machine with unsaved edits is refused before anything is detached", async () => {
    const removed: string[] = [];
    let detached = 0;
    const previous = useBackendStore.getState();
    useBackendStore.setState({
        machines: [{ ...desktop, state: "attached", isLocal: false, keepAttached: true }],
        detach: async () => {
            detached++;
        },
    });
    setEditorDirty(desktop.id, "/repo/a.ts", true);
    cleanups.push(() => {
        clearEditorDirty(desktop.id, "/repo/a.ts");
        useBackendStore.setState(previous);
    });
    window.taskflow = {
        listBackends: async () => [desktop],
        onBackendsChanged: () => () => {},
        removeBackend: async (id: string) => {
            removed.push(id);
            return { ok: true };
        },
    } as unknown as Bridge;
    await mountTokenDialog();
    const remove = [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    await act(async () => {
        remove?.click();
        await Bun.sleep(10);
    });
    expect(detached).toBe(0);
    expect(removed).toEqual([]);
    expect(document.body.textContent).toContain("/repo/a.ts");
});
