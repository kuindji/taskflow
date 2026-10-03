import { describe, expect, it } from "bun:test";
import type { Tab } from "@/stores/session-helpers";
import { isValidSessionDrop, resolveSessionDrop, sessionMovePayload } from "./session-drop";

function sidebar(): {
    zone: HTMLElement;
    card: (value: string, backendId?: string) => HTMLElement;
} {
    const zone = document.createElement("div");
    zone.dataset.sessionDropZone = "";
    return {
        zone,
        card(value, backendId = "local") {
            const host = document.createElement("div");
            host.dataset.sessionDrop = value;
            host.dataset.sessionDropBackend = backendId;
            const child = document.createElement("span");
            host.appendChild(child);
            zone.appendChild(host);
            return child;
        },
    };
}

const agentTab: Tab = { id: "s1", type: "claude", label: "Claude", sessionId: "s1", movable: true };
const taskB = { kind: "task" as const, id: "b", backendId: "local", key: "task:b" };

describe("resolveSessionDrop", () => {
    it("finds a card under an overlay and reports the zone", () => {
        const { card } = sidebar();
        const overlay = document.createElement("div");

        expect(resolveSessionDrop([overlay, card("task:b")])).toEqual({
            inZone: true,
            target: taskB,
        });
        expect(resolveSessionDrop([card("project:p1")]).target).toEqual({
            kind: "project",
            id: "p1",
            backendId: "local",
            key: "project:p1",
        });
    });

    it("reports a sidebar gap as in the zone without a target", () => {
        const { zone } = sidebar();
        expect(resolveSessionDrop([zone])).toEqual({ inZone: true, target: null });
    });

    it("ignores the workspace and malformed markers", () => {
        const { card } = sidebar();
        expect(resolveSessionDrop([document.createElement("div")])).toEqual({
            inZone: false,
            target: null,
        });
        expect(resolveSessionDrop([card("master")]).target).toBeNull();
        expect(resolveSessionDrop([card("task:")]).target).toBeNull();
        expect(resolveSessionDrop([card("task:b", "")]).target).toBeNull();
    });
});

describe("isValidSessionDrop", () => {
    const base = {
        tab: agentTab,
        sourceWorkspaceKey: "task:a",
        sourceBackendId: "local",
        target: taskB,
    };

    it("accepts a movable tab onto another owner on the same machine", () => {
        expect(isValidSessionDrop(base)).toBe(true);
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "master:right" })).toBe(true);
    });

    it("rejects shells, unflagged tabs and unknown tabs", () => {
        expect(isValidSessionDrop({ ...base, tab: { ...agentTab, movable: undefined } })).toBe(
            false,
        );
        expect(
            isValidSessionDrop({
                ...base,
                tab: { id: "x", type: "shell", label: "zsh", sessionId: "x" },
            }),
        ).toBe(false);
        expect(isValidSessionDrop({ ...base, tab: undefined })).toBe(false);
    });

    it("rejects the current owner, including from its right pane", () => {
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "task:b" })).toBe(false);
        expect(isValidSessionDrop({ ...base, sourceWorkspaceKey: "task:b:right" })).toBe(false);
    });

    it("rejects another machine or an unknown source machine", () => {
        expect(isValidSessionDrop({ ...base, target: { ...taskB, backendId: "laptop" } })).toBe(
            false,
        );
        expect(isValidSessionDrop({ ...base, sourceBackendId: null })).toBe(false);
    });
});

describe("sessionMovePayload", () => {
    it("names exactly one owner", () => {
        expect(sessionMovePayload("s1", taskB)).toEqual({ sessionId: "s1", taskId: "b" });
        expect(
            sessionMovePayload("s1", {
                kind: "project",
                id: "p",
                backendId: "local",
                key: "project:p",
            }),
        ).toEqual({ sessionId: "s1", projectId: "p" });
    });
});
