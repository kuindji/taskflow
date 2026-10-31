import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { ActionDefinition, FlowDefinition } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerFlowRoutes } from "../../src/api/routes/flow-routes";
import { FlowStore } from "../../src/services/flow-store";

const CREATED = "2026-10-01T00:00:00.000Z";

describe("flow and action definition routes", () => {
    let tempDir: string;
    let apiRouter: ApiRouter;
    let flowStore: FlowStore;

    const action: ActionDefinition = {
        id: "a1",
        name: "Plan",
        prompt: "Write a plan",
        sessionType: "claude",
        agentOptions: { type: "claude", model: "opus" },
        createdAt: CREATED,
        updatedAt: CREATED,
    };

    const flow: FlowDefinition = {
        id: "f1",
        name: "Ship",
        description: "Plan then build",
        actions: [
            { id: "e1", actionId: "a1" },
            {
                id: "e2",
                inline: { name: "Build {fast}", prompt: "Build & test", sessionType: "codex" },
            },
        ],
        inputs: [{ id: "i1", label: "Spec", type: "filepath" }],
        createdAt: CREATED,
        updatedAt: CREATED,
    };

    async function call(method: string, path: string, body?: unknown): Promise<Response> {
        const res = await apiRouter.handle(
            new Request(`http://localhost${path}`, {
                method,
                body: body === undefined ? undefined : JSON.stringify(body),
                headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            }),
        );
        if (!res) throw new Error(`No route matched ${method} ${path}`);
        return res;
    }

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-flow-definitions-"));
        flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
        await flowStore.init();
        await flowStore.saveAction(action);
        await flowStore.saveFlow(flow);
        apiRouter = new ApiRouter();
        registerFlowRoutes({
            apiRouter,
            taskStore: {} as never,
            flowStore,
            flowRunner: {} as never,
            scheduleStore: {} as never,
            broadcast: () => {},
            agents: [],
            sessionLifecycle: { createSession: () => Promise.resolve("") },
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("returns one flow or action by id, whole, and 404 for an unknown id", async () => {
        expect(await (await call("GET", "/api/flows/f1")).json()).toEqual(flow);
        expect(await (await call("GET", "/api/flow-actions/a1")).json()).toEqual(action);
        expect((await call("GET", "/api/flows/nope")).status).toBe(404);
        expect((await call("GET", "/api/flow-actions/nope")).status).toBe(404);
    });

    it("renames a flow and keeps its actions, inputs and createdAt", async () => {
        const res = await call("PATCH", "/api/flows/f1", { name: "Ship it", description: "" });
        expect(res.status).toBe(200);

        const [stored] = await flowStore.getFlows();
        expect(stored).toEqual({
            ...flow,
            name: "Ship it",
            description: "",
            updatedAt: stored.updatedAt,
        });
        expect(stored.updatedAt).not.toBe(CREATED);
        expect(await res.json()).toEqual(stored);
    });

    it("updates an action's prompt verbatim and keeps its agent options", async () => {
        const prompt = 'Build & test src/main.ts with "quotes" and {braces}';
        const res = await call("PATCH", "/api/flow-actions/a1", {
            prompt,
            sessionType: "codex",
            standalone: true,
        });
        expect(res.status).toBe(200);

        const [stored] = await flowStore.getActions();
        expect(stored).toEqual({
            ...action,
            prompt,
            sessionType: "codex",
            standalone: true,
            updatedAt: stored.updatedAt,
        });
        expect(stored.updatedAt).not.toBe(CREATED);
    });

    it("refuses unknown ids, empty and mistyped updates without writing", async () => {
        expect((await call("PATCH", "/api/flows/nope", { name: "x" })).status).toBe(404);
        expect((await call("PATCH", "/api/flow-actions/nope", { name: "x" })).status).toBe(404);
        expect((await call("PATCH", "/api/flows/f1", { actions: [] })).status).toBe(400);
        expect((await call("PATCH", "/api/flows/f1", { name: 3 })).status).toBe(400);
        expect((await call("PATCH", "/api/flow-actions/a1", { standalone: "yes" })).status).toBe(
            400,
        );
        expect(
            (await call("PATCH", "/api/flow-actions/a1", { sessionType: "gemini" })).status,
        ).toBe(400);

        expect(await flowStore.getFlows()).toEqual([flow]);
        expect(await flowStore.getActions()).toEqual([action]);
    });
});
