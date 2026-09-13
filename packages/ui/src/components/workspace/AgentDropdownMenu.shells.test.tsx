import { afterAll, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_TERMINAL_SHELL, MSG } from "@taskflow/shared";
import type { ShellListResponse } from "@taskflow/shared";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let workspaceBackend = "desktop";

await mock.module("@/hooks/useWorkspaceBackend", () => ({
    useWorkspaceBackend: () => workspaceBackend,
}));

await mock.module("@/hooks/useAgentAvailability", () => ({
    useAgentAvailability: () => [],
    isAgentAvailable: () => false,
}));

await mock.module("@/hooks/useConnectivity", () => ({
    useConnectivity: () => true,
}));

await mock.module("@/stores/settings-store", () => ({
    useSettingsStore: <T,>(
        selector: (state: {
            byBackend: Record<string, undefined>;
            settings: {
                terminal: { defaultShell: string };
                general: { favoriteAgents: string[] };
            };
        }) => T,
    ): T =>
        selector({
            byBackend: {},
            settings: {
                terminal: { defaultShell: DEFAULT_TERMINAL_SHELL },
                general: { favoriteAgents: [] },
            },
        }),
}));

await mock.module("./AgentOptionsDialog", () => ({
    AgentOptionsDialog: () => null,
}));

const { AgentDropdownMenu } = await import("./AgentDropdownMenu");
const { closeConnection, openConnection } = await import("@/lib/connection-registry");
const { startTestServer } = await import("@/lib/test-ws-server");

function shellsOf(label: string): ShellListResponse {
    const path = `/bin/${label}-zsh`;
    return { shells: [{ name: "zsh", path }], systemShellPath: path };
}

/** Desktop's shell list waits until released. */
let releaseDesktop = () => {};
const desktopHold = new Promise<void>((resolve) => {
    releaseDesktop = resolve;
});
const desktop = startTestServer("desktop", (type) =>
    type === MSG.SHELLS_LIST ? desktopHold.then(() => shellsOf("desktop")) : {},
);
const laptop = startTestServer("laptop", (type) =>
    type === MSG.SHELLS_LIST ? shellsOf("laptop") : {},
);

afterAll(() => {
    for (const id of ["desktop", "laptop"]) closeConnection(id, "detach");
    desktop.stop();
    laptop.stop();
});

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) await Bun.sleep(5);
}

test("a shell list answered after the workspace moved to another machine is not shown", async () => {
    await openConnection("desktop", desktop.origin);
    await openConnection("laptop", laptop.origin);

    const opened: (string | undefined)[] = [];
    const noop = () => {};
    const menu = () => (
        <AgentDropdownMenu
            onNewTab={(_type, shellPath) => opened.push(shellPath)}
            onRunTab={noop}
            onRunScript={noop}
            onRunAction={noop}
            onRunAgentCommand={noop}
            onStartFlow={noop}
            onManageFlows={noop}
            scripts={{}}
            defaultRuntime="bun"
            flows={[]}
            standaloneActions={[]}
            agentCommands={[]}
            activeFlowRun={null}
            showRunButton={false}
            showAgentOptions={false}
            allowSessionTabs
        />
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(menu()));
    await until(() => desktop.received.some((m) => m.type === MSG.SHELLS_LIST));

    // The same menu, now for a workspace on laptop, whose list lands first.
    workspaceBackend = "laptop";
    await act(async () => root.render(menu()));
    await until(() => laptop.received.some((m) => m.type === MSG.SHELLS_LIST));
    await act(async () => Bun.sleep(50));
    await act(async () => {
        releaseDesktop();
        await Bun.sleep(50);
    });
    const terminal = container.querySelector<HTMLButtonElement>(
        'button[aria-label="New terminal"]',
    );
    await act(async () => terminal?.click());

    expect(opened).toEqual(["/bin/laptop-zsh"]);
    await act(async () => root.unmount());
});
