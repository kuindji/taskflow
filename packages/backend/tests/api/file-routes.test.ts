import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ApiRouter } from "../../src/api/router";
import { TaskStore } from "../../src/services/task-store";
import { registerFileRoutes } from "../../src/api/routes/file-routes";

const BASE = "http://localhost";

describe("GET /api/file/raw", () => {
    let tempDir: string;
    let projectDir: string;
    let outsideDir: string;
    let store: TaskStore;
    let apiRouter: ApiRouter;

    async function get(path: string): Promise<Response> {
        const url = `${BASE}/api/file/raw?path=${encodeURIComponent(path)}`;
        const res = await apiRouter.handle(new Request(url));
        if (!res) throw new Error(`No route matched ${url}`);
        return res;
    }

    beforeEach(async () => {
        tempDir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-raw-")));
        projectDir = join(tempDir, "project");
        outsideDir = join(tempDir, "outside");
        await mkdir(join(projectDir, "docs"), { recursive: true });
        await mkdir(outsideDir, { recursive: true });
        await writeFile(join(projectDir, "docs", "diagram.png"), "PNGDATA");
        await writeFile(join(outsideDir, "secret.txt"), "TOPSECRET");

        store = new TaskStore({
            projectsFile: join(tempDir, "projects.json"),
            tasksDir: join(tempDir, "tasks"),
            archiveDir: join(tempDir, "archive"),
            sessionLogsDir: join(tempDir, "session-logs"),
            taskLogsDir: join(tempDir, "task-logs"),
        });
        await store.init();
        await store.addProject({ path: projectDir });

        apiRouter = new ApiRouter();
        registerFileRoutes({ apiRouter, taskStore: store });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("serves a file inside a project root with a content type", async () => {
        const res = await get(join(projectDir, "docs", "diagram.png"));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await res.text()).toBe("PNGDATA");
    });

    it("rejects a path outside every workspace root", async () => {
        const res = await get(join(outsideDir, "secret.txt"));
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("TOPSECRET");
    });

    it("rejects dot-dot traversal out of a project root", async () => {
        const res = await get(join(projectDir, "docs", "..", "..", "outside", "secret.txt"));
        expect(res.status).toBe(403);
    });

    it("rejects percent-encoded traversal", async () => {
        const url = `${BASE}/api/file/raw?path=${encodeURIComponent(projectDir)}%2F..%2Foutside%2Fsecret.txt`;
        const res = await apiRouter.handle(new Request(url));
        expect(res?.status).toBe(403);
    });

    it("rejects a symlink inside the root that points outside it", async () => {
        await symlink(join(outsideDir, "secret.txt"), join(projectDir, "docs", "leak.txt"));
        const res = await get(join(projectDir, "docs", "leak.txt"));
        expect(res.status).toBe(403);
    });

    it("returns 404 for a missing file inside the root", async () => {
        const res = await get(join(projectDir, "docs", "nope.png"));
        expect(res.status).toBe(404);
    });

    it("returns 400 when the path parameter is absent", async () => {
        const res = await apiRouter.handle(new Request(`${BASE}/api/file/raw`));
        expect(res?.status).toBe(400);
    });

    it("returns 403 for a directory rather than streaming it", async () => {
        const res = await get(join(projectDir, "docs"));
        expect(res.status).toBe(403);
    });

    it("serves svg with a locked-down CSP", async () => {
        await writeFile(join(projectDir, "docs", "d.svg"), "<svg/>");
        const res = await get(join(projectDir, "docs", "d.svg"));
        expect(res.headers.get("content-type")).toBe("image/svg+xml");
        expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    });
});
