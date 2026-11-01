import { afterEach, beforeEach, expect, test } from "bun:test";
import { setPrimary } from "@/lib/connection-registry";
import { MASTER_WORKSPACE_KEY } from "@/hooks/useActiveWorkspace";
import { terminalCache, type CachedTerminal } from "@/components/panes/terminal/terminal-lifecycle";
import { useSessionStore, type Tab } from "@/stores/session-store";
import { requestCloseTab } from "./close-tab";

/**
 * A terminal tab whose machine is attached but does not take the close stays
 * open (its process may live on). Its terminal must stay too, or the kept tab
 * is left blank with no recovery subscription.
 */

const SESSION = "close-tab-session";
const tab: Tab = { id: "t1", type: "shell", label: "zsh", sessionId: SESSION };
const realCloseTab = useSessionStore.getState().closeTab;
let disposed: boolean;

function cacheFakeTerminal() {
    disposed = false;
    const noop = () => {};
    const fake = {
        element: document.createElement("div"),
        unsubOutput: noop,
        unsubExit: noop,
        unsubRecovery: noop,
        attachment: { dispose: noop },
        disposeRuntime: noop,
        term: {
            dispose: () => {
                disposed = true;
            },
        },
    };
    terminalCache.set(SESSION, fake as unknown as CachedTerminal);
}

beforeEach(() => {
    setPrimary("close-tab-backend");
    useSessionStore.setState({
        tabsByWorkspace: { [MASTER_WORKSPACE_KEY]: [tab] },
        activeTabByWorkspace: { [MASTER_WORKSPACE_KEY]: tab.id },
    });
    cacheFakeTerminal();
});

afterEach(() => {
    terminalCache.delete(SESSION);
    useSessionStore.setState({ closeTab: realCloseTab, tabsByWorkspace: {} });
});

test("a close the machine refuses keeps the terminal", async () => {
    let fail: (error: Error) => void = () => {};
    const closing = new Promise<void>((_resolve, reject) => {
        fail = reject;
    });
    useSessionStore.setState({ closeTab: () => closing });

    requestCloseTab(MASTER_WORKSPACE_KEY, tab);
    fail(new Error("not connected"));
    await closing.catch(() => {});
    await Promise.resolve();

    expect(terminalCache.has(SESSION)).toBe(true);
    expect(disposed).toBe(false);
});

test("a close that goes through disposes the terminal", async () => {
    useSessionStore.setState({ closeTab: () => Promise.resolve() });

    requestCloseTab(MASTER_WORKSPACE_KEY, tab);
    await Promise.resolve();
    await Promise.resolve();

    expect(terminalCache.has(SESSION)).toBe(false);
    expect(disposed).toBe(true);
});
