// Repro for a design hazard in the remote-projects spec, run against CURRENT code.
// syncOwnerTabs rebuilds the "task:" namespace from the owners it is handed, so a
// caller that passes only ONE machine's tasks silently drops the OTHER machine's
// open session tabs. Today there is only ever one backend, so this cannot happen.
// Under an aggregated task array it happens on any partial fan-out result.
import { describe, expect, test } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { syncOwnerTabs } from "./session-sync";
import { createSessionTab } from "./session-helpers";

function makeSession(id: string): SessionRef {
    return {
        id,
        type: "claude",
        label: "Claude",
        createdAt: "2026-01-01T00:00:00.000Z",
        instance: "test",
    };
}

describe("aggregated task array + syncOwnerTabs", () => {
    test("a fan-out result missing one machine's tasks drops that machine's live tabs", () => {
        const laptopSession = makeSession("session-laptop");
        const desktopSession = makeSession("session-desktop");
        const laptopTab = createSessionTab(laptopSession);
        const desktopTab = createSessionTab(desktopSession);

        // Both machines attached, both have a live session tab open.
        const tabsByWorkspace = {
            "task:laptop-task": [laptopTab],
            "task:desktop-task": [desktopTab],
        };
        const activeTabByWorkspace = {
            "task:laptop-task": laptopTab.id,
            "task:desktop-task": desktopTab.id,
        };

        // The laptop refetches its own tasks. Its leg of the fan-out returns first
        // (or the desktop's leg fails), so the aggregated array momentarily holds
        // only the laptop's tasks.
        const result = syncOwnerTabs({
            owners: [{ id: "laptop-task", sessions: [laptopSession] }],
            keyPrefix: "task:",
            getWorkspaceKey: (id: string) => `task:${id}`,
            tabsByWorkspace,
            activeTabByWorkspace,
            pendingSessionCreates: new Set<string>(),
        });

        // The laptop's tab survives, as it should.
        expect(result.tabsByWorkspace["task:laptop-task"]).toHaveLength(1);

        // The desktop's tab is gone — a live remote terminal closed by a refetch
        // on an unrelated, healthy machine. This is what the spec must prevent.
        expect(result.tabsByWorkspace["task:desktop-task"]).toBeUndefined();
    });
});
