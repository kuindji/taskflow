import { describe, expect, it } from "bun:test";
import type { SessionRef } from "@taskflow/shared";
import { SessionController, type ControllerBridge, type SessionTab } from "./controller";

function ref(id: string, label = id): SessionRef {
    return { id, label, type: "shell", createdAt: "now" };
}

function setup() {
    const created: Array<{ id: string; bridge: ControllerBridge; calls: string[] }> = [];
    const changes: Array<{ tabs: readonly SessionTab[]; activeId: string | null }> = [];
    const requests: Array<{ type: string; payload: unknown }> = [];
    let createResponse = "created";
    let requestError: Error | null = null;
    const controller = new SessionController({
        createBridge(session) {
            const calls: string[] = [];
            const bridge = {
                renderable: { id: `renderable-${session.id}` },
                attach: async () => {
                    calls.push("attach");
                },
                setActive: () => undefined,
                focus: () => undefined,
                blur: () => undefined,
                setInputEnabled: (enabled: boolean) => calls.push(`input:${String(enabled)}`),
                destroy: () => calls.push("destroy"),
            } as unknown as ControllerBridge;
            created.push({ id: session.id, bridge, calls });
            return bridge;
        },
        async request<T>(type: string, payload?: unknown) {
            requests.push({ type, payload });
            if (requestError) throw requestError;
            return { sessionId: createResponse } as T;
        },
        onChange(tabs, activeId) {
            changes.push({ tabs: [...tabs], activeId });
        },
    });
    return {
        controller,
        created,
        changes,
        requests,
        setCreateResponse: (id: string) => {
            createResponse = id;
        },
        setRequestError: (error: Error | null) => {
            requestError = error;
        },
    };
}

describe("SessionController", () => {
    it("creates and attaches each supported session once", async () => {
        const { controller, created } = setup();
        controller.reconcile({ kind: "master" }, [
            ref("a"),
            ref("b"),
            { ...ref("e"), type: "editor" },
        ]);
        await Promise.resolve();
        expect(created.map((item) => item.id)).toEqual(["a", "b"]);
        expect(created.map((item) => item.calls)).toEqual([
            ["input:true", "attach"],
            ["input:true", "attach"],
        ]);
        expect(controller.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
    });

    it("keeps bridge identity while metadata changes", () => {
        const { controller } = setup();
        controller.reconcile({ kind: "project", projectId: "p" }, [ref("a", "Old")]);
        const first = controller.tabs[0];
        controller.reconcile({ kind: "project", projectId: "p" }, [
            { ...ref("a", "New"), state: "interrupted", nativeSessionId: "native" },
        ]);
        expect(controller.tabs[0].bridge).toBe(first.bridge);
        expect(controller.tabs[0]).toMatchObject({
            label: "New",
            state: "interrupted",
            nativeSessionId: "native",
        });
    });

    it("destroys removed and old-owner bridges exactly once", () => {
        const { controller, created } = setup();
        controller.reconcile({ kind: "project", projectId: "p1" }, [ref("a"), ref("b")]);
        controller.reconcile({ kind: "project", projectId: "p1" }, [ref("b")]);
        controller.reconcile({ kind: "project", projectId: "p2" }, [ref("c")]);
        expect(created.find((item) => item.id === "a")?.calls).toContain("destroy");
        expect(created.find((item) => item.id === "b")?.calls).toContain("destroy");
        expect(created.find((item) => item.id === "c")?.calls).not.toContain("destroy");
        expect(
            created.find((item) => item.id === "a")?.calls.filter((call) => call === "destroy"),
        ).toHaveLength(1);
    });

    it("remembers the active tab per owner and picks a nearest survivor", () => {
        const { controller, changes } = setup();
        const p1 = { kind: "project" as const, projectId: "p1" };
        const p2 = { kind: "project" as const, projectId: "p2" };
        controller.reconcile(p1, [ref("a"), ref("b"), ref("c")]);
        controller.select("b");
        controller.reconcile(p1, [ref("a"), ref("c")]);
        expect(changes.at(-1)?.activeId).toBe("c");
        controller.select("c");
        controller.reconcile(p2, [ref("x")]);
        controller.reconcile(p1, [ref("a"), ref("c")]);
        expect(changes.at(-1)?.activeId).toBe("c");
    });

    it("reattaches every current bridge once on reconnect", async () => {
        const { controller, created } = setup();
        controller.reconcile({ kind: "master" }, [ref("a"), ref("b")]);
        await Promise.resolve();
        controller.reattach();
        await Promise.resolve();
        expect(
            created.map((item) => item.calls.filter((call) => call === "attach").length),
        ).toEqual([2, 2]);
    });

    it("activates one created session for broadcast-before-response ordering", async () => {
        const { controller, changes, requests, setCreateResponse } = setup();
        const owner = { kind: "master" as const };
        setCreateResponse("new");
        controller.reconcile(owner, [ref("new")]);
        await controller.create(owner, { master: true, type: "shell", shell: "/bin/sh" });
        expect(requests).toHaveLength(1);
        expect(changes.at(-1)?.activeId).toBe("new");
        expect(controller.tabs.map((tab) => tab.id)).toEqual(["new"]);
    });

    it("remembers a response-before-broadcast creation without inventing a tab", async () => {
        const { controller, changes, setCreateResponse } = setup();
        const owner = { kind: "project" as const, projectId: "p" };
        controller.reconcile(owner, []);
        setCreateResponse("new");
        await controller.create(owner, { projectId: "p", type: "codex" });
        expect(controller.tabs).toHaveLength(0);
        controller.reconcile(owner, [ref("new")]);
        expect(controller.tabs).toHaveLength(1);
        expect(changes.at(-1)?.activeId).toBe("new");
    });

    it("sends close once and keeps the tab until Store removes it", async () => {
        const { controller, requests } = setup();
        controller.reconcile({ kind: "master" }, [ref("a")]);
        await Promise.all([controller.close("a"), controller.close("a")]);
        expect(requests.filter((request) => request.type === "session:close")).toHaveLength(1);
        expect(controller.tabs.map((tab) => tab.id)).toEqual(["a"]);
        controller.reconcile({ kind: "master" }, []);
        expect(controller.tabs).toHaveLength(0);
    });

    it("marks an eligible agent resuming and sends the current dimensions once", async () => {
        const { controller, requests, setCreateResponse } = setup();
        setCreateResponse("a");
        const interrupted: SessionRef = {
            ...ref("a"),
            type: "codex",
            state: "interrupted",
            nativeSessionId: "native-a",
        };
        controller.reconcile({ kind: "master" }, [interrupted]);
        await Promise.all([controller.resume("a", 101, 37), controller.resume("a", 101, 37)]);
        expect(requests.filter((request) => request.type === "session:resume")).toEqual([
            { type: "session:resume", payload: { sessionId: "a", cols: 101, rows: 37 } },
        ]);
        expect(controller.tabs[0]?.state).toBe("resuming");
    });

    it("reattaches the retained bridge when Store reports a resumed session live", async () => {
        const { controller, created } = setup();
        const interrupted: SessionRef = {
            ...ref("a"),
            type: "codex",
            state: "interrupted",
            nativeSessionId: "native-a",
        };
        controller.reconcile({ kind: "master" }, [interrupted]);
        await controller.resume("a", 80, 24);
        controller.reconcile({ kind: "master" }, [{ ...interrupted, state: "live" }]);
        await Promise.resolve();
        const calls = created[0].calls;
        expect(calls.filter((call) => call === "attach")).toHaveLength(2);
        expect(calls.at(-2)).toBe("input:true");
        expect(controller.tabs[0]?.bridge).toBe(created[0].bridge);
    });

    it("rejects ineligible resume attempts without a request", async () => {
        const { controller, requests } = setup();
        controller.reconcile({ kind: "master" }, [
            { ...ref("shell"), state: "interrupted", nativeSessionId: "native" },
        ]);
        expect(controller.resume("shell", 80, 24)).rejects.toThrow("cannot be resumed");
        expect(requests.filter((request) => request.type === "session:resume")).toHaveLength(0);
    });

    it("returns to interrupted after a failed resume and permits retry", async () => {
        const { controller, created, requests, setRequestError } = setup();
        const interrupted: SessionRef = {
            ...ref("a"),
            type: "codex",
            state: "interrupted",
            nativeSessionId: "native-a",
        };
        controller.reconcile({ kind: "master" }, [interrupted]);
        setRequestError(new Error("resume failed"));
        expect(controller.resume("a", 80, 24)).rejects.toThrow("resume failed");
        expect(controller.tabs[0]?.state).toBe("interrupted");
        expect(created[0].calls.filter((call) => call === "attach")).toHaveLength(1);
        setRequestError(null);
        await controller.resume("a", 81, 25);
        expect(requests.filter((request) => request.type === "session:resume")).toHaveLength(2);
    });
});
