import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { ActionDefinition, FlowDefinition, FlowRun } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { FlowStore } from "./store";

const timestamp = "2026-08-25T00:00:00.000Z";

function action(id: string): ActionDefinition {
    return {
        id,
        name: id,
        prompt: "echo ok",
        sessionType: "shell",
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function flow(id: string): FlowDefinition {
    return {
        id,
        name: id,
        description: "",
        actions: [{ id: "entry", actionId: "a1" }],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function run(
    flowId: string,
    status: FlowRun["status"] = "running",
    startedAt = timestamp,
    projectId = "p1",
): FlowRun {
    return {
        projectId,
        flowId,
        status,
        currentActionIndex: 0,
        actions: [{ actionEntryId: "entry", status: status === "failed" ? "failed" : "running" }],
        artifacts: [],
        startedAt,
    };
}

interface FakeNet extends NetLike {
    calls: Array<{ type: string; payload: unknown }>;
    emit(type: string, payload: unknown): void;
    listenerCount(type: string): number;
    respond(type: string, response: unknown | Error): void;
}

function fakeNet(): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    const responses = new Map<string, Array<unknown | Error>>();
    const calls: Array<{ type: string; payload: unknown }> = [];
    return {
        calls,
        request<T>(type: string, payload?: unknown): Promise<T> {
            calls.push({ type, payload });
            const response = responses.get(type)?.shift();
            if (response instanceof Error) return Promise.reject(response);
            if (response === undefined) return Promise.resolve({ success: true } as T);
            return Promise.resolve(response as T);
        },
        on(type, handler) {
            const set = listeners.get(type) ?? new Set();
            set.add(handler);
            listeners.set(type, set);
            return () => set.delete(handler);
        },
        onStatusChange: () => () => undefined,
        emit(type, payload) {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
        listenerCount(type) {
            return listeners.get(type)?.size ?? 0;
        },
        respond(type, response) {
            const queue = responses.get(type) ?? [];
            queue.push(response);
            responses.set(type, queue);
        },
    };
}

describe("FlowStore", () => {
    it("loads definitions together and retains the selected owner's terminal run", async () => {
        const net = fakeNet();
        net.respond(MSG.FLOW_DEFINITIONS_LIST, { flows: [flow("f1")] });
        net.respond(MSG.FLOW_ACTIONS_LIST, { actions: [action("a1")] });
        net.respond(MSG.FLOW_RUNS_LIST, {
            runs: [
                run("old", "completed", "2026-08-24T00:00:00.000Z"),
                run("latest", "failed", "2026-08-25T00:00:00.000Z"),
            ],
        });
        const store = new FlowStore(net);

        await store.loadDefinitions();
        await store.loadRun({ kind: "project", projectId: "p1" });

        expect(store.flows.map((item) => item.id)).toEqual(["f1"]);
        expect(store.actions.map((item) => item.id)).toEqual(["a1"]);
        expect(store.runFor("p1")?.flowId).toBe("latest");
        expect(net.calls.at(-1)).toEqual({
            type: MSG.FLOW_RUNS_LIST,
            payload: { ownerId: "p1" },
        });
    });

    it("folds active and terminal updates without adding unrelated terminal runs", () => {
        const net = fakeNet();
        const store = new FlowStore(net);
        net.emit(MSG.FLOW_RUN_UPDATED, run("f1"));
        net.emit(MSG.FLOW_RUN_UPDATED, run("f1", "completed"));
        net.emit(MSG.FLOW_RUN_UPDATED, run("untracked", "failed"));

        expect(store.runFor("p1")?.flowId).toBe("f1");
        expect(store.runFor("p1")?.status).toBe("completed");
        store.dismissRun("p1");
        expect(store.runFor("p1")).toBeNull();
    });

    it("changes confirmed state only after successful requests", async () => {
        const net = fakeNet();
        const store = new FlowStore(net);
        net.respond(MSG.FLOW_DEFINITION_SAVE, flow("saved"));
        await store.saveFlow(flow("saved"));
        net.respond(MSG.FLOW_DEFINITION_SAVE, new Error("save failed"));
        await expect(store.saveFlow(flow("rejected"))).rejects.toThrow("save failed");
        expect(store.flows.map((item) => item.id)).toEqual(["saved"]);

        net.respond(MSG.FLOW_START, run("started"));
        await store.startFlow({ projectId: "p1", flowId: "started" });
        expect(store.runFor("p1")?.flowId).toBe("started");
    });

    it("subscribes once and disposes idempotently", () => {
        const net = fakeNet();
        const store = new FlowStore(net);
        expect(net.listenerCount(MSG.FLOW_RUN_UPDATED)).toBe(1);
        store.dispose();
        store.dispose();
        expect(net.listenerCount(MSG.FLOW_RUN_UPDATED)).toBe(0);
    });

    it("prevents an older owner load from overwriting a newer selection", async () => {
        const listeners = new Map<string, Set<(payload: unknown) => void>>();
        const resolvers: Array<(value: { runs: FlowRun[] }) => void> = [];
        const net: NetLike = {
            request<T>(type: string): Promise<T> {
                if (type !== MSG.FLOW_RUNS_LIST) throw new Error(`unexpected ${type}`);
                return new Promise((resolve) => resolvers.push(resolve as never));
            },
            on(type, handler) {
                const set = listeners.get(type) ?? new Set();
                set.add(handler);
                listeners.set(type, set);
                return () => set.delete(handler);
            },
            onStatusChange: () => () => undefined,
        };
        const store = new FlowStore(net);
        const first = store.loadRun({ kind: "project", projectId: "p1" });
        const second = store.loadRun({ kind: "project", projectId: "p2" });
        resolvers[1]?.({ runs: [run("new", "running", timestamp, "p2")] });
        await second;
        resolvers[0]?.({ runs: [run("stale")] });
        await first;
        expect(store.runFor("p2")?.flowId).toBe("new");
        expect(store.runFor("p1")).toBeNull();
    });
});
