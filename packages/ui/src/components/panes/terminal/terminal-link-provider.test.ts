import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { ILink } from "@xterm/xterm";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { createTerminalWithText } from "@/lib/test-headless-terminal";
import { startTestServer } from "@/lib/test-ws-server";
import type { TestServer } from "@/lib/test-ws-server";
import { useBackendStore } from "@/stores/backend-store";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";
import { createFilePathLinkProvider } from "./terminal-link-provider";

let server: TestServer;
const revealed: string[] = [];
const originalBridge = Object.getOwnPropertyDescriptor(window, "taskflow");

beforeAll(async () => {
    server = startTestServer("links", (type) =>
        type === MSG.FILE_STAT ? { exists: true, isDirectory: true } : {},
    );
    await openConnection("links", server.origin);
    setPrimary("links");
});

afterAll(() => {
    closeConnection("links", "detach");
    server.stop();
});

beforeEach(() => {
    server.received.length = 0;
    revealed.length = 0;
    Object.defineProperty(window, "taskflow", {
        configurable: true,
        value: { showItemInFolder: (path: string) => revealed.push(path) },
    });
    // The session moved to Master; the explorer shows another directory.
    useSessionStore.setState({
        tabsByWorkspace: {
            master: [{ id: "s1", type: "claude", label: "Claude", sessionId: "s1", cwd: "/repo" }],
        },
    });
    useFileStore.setState({ treePath: "/elsewhere" });
    useUIStore.setState({ fileExplorerOpen: false });
});

afterEach(() => {
    if (originalBridge) Object.defineProperty(window, "taskflow", originalBridge);
    else Reflect.deleteProperty(window, "taskflow");
});

/** Each test uses its own directory: stats are cached per path. */
async function clickDirectoryLink(dir: string): Promise<void> {
    const term = await createTerminalWithText(`see ${dir} here`, 40);
    const provider = createFilePathLinkProvider(term, "s1", undefined, undefined, true);
    const links = await new Promise<ILink[] | undefined>((resolve) =>
        provider.provideLinks(1, resolve),
    );
    const link = links?.find((l) => l.text === dir);
    expect(link).toBeDefined();
    link?.activate(new MouseEvent("click"), dir);
    // Activation `void`s its work: wait for the stat it starts, then let it finish.
    for (let i = 0; i < 100 && !server.received.some((r) => r.type === MSG.FILE_STAT); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("a directory link outside the explorer's tree", () => {
    it("opens in Finder on this machine", async () => {
        useBackendStore.setState({ machines: [] });

        await clickDirectoryLink("src/lib");

        expect(revealed).toEqual(["/repo/src/lib"]);
        expect(useUIStore.getState().fileExplorerOpen).toBe(false);
    });

    it("opens nothing on another machine", async () => {
        useBackendStore.setState({
            machines: [
                {
                    id: "links",
                    displayName: "Remote",
                    host: "remote",
                    instanceId: "main",
                    state: "attached",
                    isLocal: false,
                    keepAttached: true,
                },
            ],
        });

        await clickDirectoryLink("src/app");

        expect(revealed).toEqual([]);
        expect(useUIStore.getState().fileExplorerOpen).toBe(false);
    });
});
