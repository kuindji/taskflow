import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { latestArtifactsByType, type FlowArtifact, type FlowRun } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerFlowRoutes } from "../../src/api/routes/flow-routes";

const BASE = "http://localhost/api/flow/artifact";

describe("GET /api/flow/artifact/:ownerId/:flowId/:type/raw", () => {
    let tempDir: string;
    let apiRouter: ApiRouter;
    let runs: FlowRun[];

    function run(artifacts: FlowArtifact[]): FlowRun {
        return {
            taskId: "task-1",
            flowId: "flow-1",
            status: "running",
            currentActionIndex: 0,
            actions: [],
            artifacts,
            startedAt: "2026-09-13T00:00:00.000Z",
        };
    }

    function artifact(type: string, patch: Partial<FlowArtifact>): FlowArtifact {
        return { type, actionEntryId: "entry-1", createdAt: "2026-09-13T01:00:00.000Z", ...patch };
    }

    async function get(path: string): Promise<Response> {
        const res = await apiRouter.handle(new Request(`${BASE}/${path}`));
        if (!res) throw new Error(`No route matched ${path}`);
        return res;
    }

    beforeEach(async () => {
        // Deliberately outside any project root: /api/file/raw would refuse it.
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-artifact-raw-"));
        runs = [];
        apiRouter = new ApiRouter();
        registerFlowRoutes({
            apiRouter,
            taskStore: {} as never,
            flowStore: {
                getFlowRun: (ownerId: string, flowId: string) =>
                    Promise.resolve(
                        runs.find((r) => r.taskId === ownerId && r.flowId === flowId) ?? null,
                    ),
            } as never,
            flowRunner: {
                getArtifacts: (r: FlowRun, type?: string) =>
                    latestArtifactsByType(
                        type ? r.artifacts.filter((a) => a.type === type) : r.artifacts,
                    ),
            } as never,
            broadcast: () => {},
            agents: [],
            sessionLifecycle: { createSession: () => Promise.resolve("") },
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("serves the bytes at the path the run registered, outside every workspace", async () => {
        const file = join(tempDir, "report.bin");
        await writeFile(file, "REPORT");
        runs.push(run([artifact("report", { path: file })]));

        const res = await get("task-1/flow-1/report/raw");

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/octet-stream");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await res.text()).toBe("REPORT");
    });

    it("serves the newest artifact of the type", async () => {
        const older = join(tempDir, "older.md");
        const newer = join(tempDir, "newer.md");
        await writeFile(older, "OLD");
        await writeFile(newer, "NEW");
        runs.push(
            run([
                artifact("plan", { path: older, createdAt: "2026-09-13T01:00:00.000Z" }),
                artifact("plan", {
                    path: newer,
                    actionEntryId: "entry-2",
                    createdAt: "2026-09-13T02:00:00.000Z",
                }),
            ]),
        );

        expect(await (await get("task-1/flow-1/plan/raw")).text()).toBe("NEW");
    });

    it("decodes an encoded type", async () => {
        const file = join(tempDir, "notes.txt");
        await writeFile(file, "NOTES");
        runs.push(run([artifact("my notes", { path: file })]));

        const res = await get(`task-1/flow-1/${encodeURIComponent("my notes")}/raw`);

        expect(res.status).toBe(200);
        expect(await res.text()).toBe("NOTES");
    });

    it("refuses what is not a registered file", async () => {
        const dir = join(tempDir, "dir");
        await mkdir(dir);
        runs.push(
            run([
                artifact("summary", { text: "hello" }),
                artifact("relative", { path: "docs/plan.md" }),
                artifact("missing", { path: join(tempDir, "gone.md") }),
                artifact("folder", { path: dir }),
            ]),
        );

        for (const path of [
            "task-2/flow-1/summary/raw",
            "task-1/flow-1/unknown/raw",
            "task-1/flow-1/summary/raw",
            "task-1/flow-1/relative/raw",
            "task-1/flow-1/missing/raw",
            "task-1/flow-1/folder/raw",
        ]) {
            expect({ path, status: (await get(path)).status }).toEqual({ path, status: 404 });
        }
    });
});
