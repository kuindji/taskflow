import { describe, expect, it } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { useSessionStore } from "./session-store";

describe("master workspace tabs", () => {
    it("refresh movable and cwd in both panes", () => {
        const session: SessionRef = {
            id: "m1",
            type: "claude",
            label: "Claude",
            createdAt: "2026-10-03T00:00:00.000Z",
            instance: "main",
            cwd: "/home/me",
        };
        useSessionStore.setState({
            tabsByWorkspace: {
                "master:right": [{ id: "m1", type: "claude", label: "Claude", sessionId: "m1" }],
            },
            activeTabByWorkspace: { "master:right": "m1" },
        });

        useSessionStore.getState().syncWithMasterSessions("local", [session]);

        expect(useSessionStore.getState().tabsByWorkspace["master:right"]?.[0]).toMatchObject({
            movable: true,
            cwd: "/home/me",
        });
        expect(useSessionStore.getState().tabsByWorkspace.master).toBeUndefined();
    });
});
