import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { MenuEntry, TunnelFailure } from "@taskflow/shared";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { MachinesMenu } from "./MachinesMenu";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Bridge = NonNullable<Window["taskflow"]>;

const original = useBackendStore.getState();
const originalBridge = window.taskflow;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    window.taskflow = originalBridge;
    useBackendStore.setState({
        machines: [],
        primaryId: null,
        attach: original.attach,
        detach: original.detach,
        refresh: original.refresh,
    });
});

function machine(changes: Partial<MachineState>): MachineState {
    return {
        id: "laptop-uid",
        displayName: "Laptop",
        host: "laptop.lan",
        instanceId: "main",
        state: "attached",
        isLocal: false,
        keepAttached: true,
        ...changes,
    };
}

interface Calls {
    attached: string[];
    detached: string[];
    added: string[];
    trusted: string[];
}

/** A bridge with no native menu, so the Radix menu renders; store actions record calls. */
function setup(machines: MachineState[], entries: MenuEntry[], fingerprint = ""): Calls {
    const calls: Calls = { attached: [], detached: [], added: [], trusted: [] };
    const bridge: Pick<
        Bridge,
        | "listBackends"
        | "probeBackends"
        | "onBackendsChanged"
        | "addDiscoveredBackend"
        | "getHostFingerprint"
        | "trustBackendHost"
    > = {
        listBackends: () => Promise.resolve(entries),
        probeBackends: () => Promise.resolve(),
        onBackendsChanged: () => () => {},
        addDiscoveredBackend: (id) => {
            calls.added.push(id);
            return Promise.resolve(null);
        },
        getHostFingerprint: () => Promise.resolve({ ok: true, fingerprint }),
        trustBackendHost: (id) => {
            calls.trusted.push(id);
            return Promise.resolve({ ok: true });
        },
    };
    window.taskflow = bridge as Bridge;
    useBackendStore.setState({
        machines,
        primaryId: "local",
        attach: (id) => {
            calls.attached.push(id);
            return Promise.resolve(id);
        },
        detach: (id) => {
            calls.detached.push(id);
            return Promise.resolve();
        },
        refresh: () => Promise.resolve(),
    });
    return calls;
}

async function render(): Promise<void> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(<MachinesMenu masterWorkspaceActive={false} onMasterWorkspace={() => {}} />),
    );
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
}

async function openMenu(): Promise<void> {
    const trigger = document.querySelector<HTMLButtonElement>("button[aria-label='Machines']");
    if (!trigger) throw new Error("no machines button");
    await act(async () => {
        trigger.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }),
        );
        await Bun.sleep(10);
    });
}

function checkboxes(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>("[role='menuitemcheckbox']")];
}

function checkboxNamed(name: string): HTMLElement | undefined {
    return checkboxes().find((item) => item.textContent?.includes(name));
}

const local = machine({ id: "local", displayName: "This machine", isLocal: true });
const laptop = machine({ id: "laptop-uid", displayName: "Laptop" });
const desktop = machine({
    id: "desktop-uid",
    displayName: "Desktop",
    state: "offline",
    keepAttached: false,
});
const discovered: MenuEntry = {
    id: "192.168.1.66:main",
    displayName: "Studio",
    instanceId: "main",
    host: "192.168.1.66",
    attached: false,
    saved: false,
    seen: true,
};

test("every known machine has a checkbox that reflects whether it is kept attached", async () => {
    setup([local, laptop, desktop], [discovered]);
    await render();
    await openMenu();

    expect(checkboxNamed("This machine")?.getAttribute("aria-checked")).toBe("true");
    expect(checkboxNamed("Laptop")?.getAttribute("aria-checked")).toBe("true");
    expect(checkboxNamed("Desktop")?.getAttribute("aria-checked")).toBe("false");
    // Primary cannot be unticked: leaving it is a hard switch.
    expect(checkboxNamed("This machine")?.hasAttribute("data-disabled")).toBe(true);
});

test("ticking an unticked machine attaches it and unticking a ticked one detaches it", async () => {
    const calls = setup([local, laptop, desktop], []);
    await render();
    await openMenu();

    await act(async () => checkboxNamed("Desktop")?.click());
    await act(async () => checkboxNamed("Laptop")?.click());

    expect(calls.attached).toEqual(["desktop-uid"]);
    expect(calls.detached).toEqual(["laptop-uid"]);
});

test("a discovered, unsaved machine is offered to add and has no checkbox", async () => {
    const calls = setup([local], [discovered]);
    await render();
    await openMenu();

    expect(checkboxNamed("Studio")).toBeUndefined();
    const add = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find((item) =>
        item.textContent?.includes("Add Studio"),
    );
    expect(add).toBeDefined();
    await act(async () => add?.click());
    expect(calls.added).toEqual(["192.168.1.66:main"]);
});

test("Work as… is its own submenu entry, not another checkbox row", async () => {
    setup([local, laptop], []);
    await render();
    await openMenu();

    const workAs = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find((item) =>
        item.textContent?.includes("Work as"),
    );
    expect(workAs?.getAttribute("aria-haspopup")).toBe("menu");
    expect(checkboxes().some((item) => item.textContent?.includes("Work as"))).toBe(false);
});

function hostKeyFailure(kind: TunnelFailure["kind"], stderr = ""): TunnelFailure {
    return { kind, message: "ssh said no", stderr };
}

test("an untrusted host shows its fingerprint, and trusting pins it and attaches", async () => {
    const calls = setup(
        [
            local,
            machine({
                id: "desktop-uid",
                displayName: "Desktop",
                state: "offline",
                failure: hostKeyFailure("unknown-host-key"),
            }),
        ],
        [],
        "256 SHA256:abcDEF desktop.lan (ED25519)",
    );
    await render();
    await act(() => Bun.sleep(10));

    expect(document.body.textContent).toContain("SHA256:abcDEF");
    expect(document.body.textContent).toContain("ED25519");
    const trust = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "Trust and connect",
    );
    await act(async () => {
        trust?.click();
        await Bun.sleep(10);
    });

    expect(calls.trusted).toEqual(["desktop-uid"]);
    expect(calls.attached).toEqual(["desktop-uid"]);
});

test("a changed host key is never offered for trust and shows the offending line", async () => {
    const calls = setup(
        [
            local,
            machine({
                id: "desktop-uid",
                displayName: "Desktop",
                state: "offline",
                failure: hostKeyFailure(
                    "changed-host-key",
                    "@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@\nOffending ED25519 key in /Users/me/.taskflow/known_hosts:3\n",
                ),
            }),
        ],
        [],
        "256 SHA256:abcDEF desktop.lan (ED25519)",
    );
    await render();
    await act(() => Bun.sleep(10));

    expect(document.body.textContent).toContain("Offending ED25519 key in");
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Trust and connect");
    expect(document.body.textContent).not.toContain("SHA256:abcDEF");
    expect(calls.trusted).toEqual([]);
});
