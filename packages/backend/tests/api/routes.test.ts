import { beforeEach, afterEach, describe, expect, it } from "bun:test";
import { MSG, type AppSettings, type WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerApiRoutes } from "../../src/api/routes";
import { SettingsStore } from "../../src/services/settings-store";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

class FakePtyManager {
    constructor(private readonly activeSessionIds = new Set<string>()) {}

    has(sessionId: string): boolean {
        return this.activeSessionIds.has(sessionId);
    }

    close(): void {}
}

describe("api routes", () => {
    let apiRouter: ApiRouter;
    let events: WsEvent[];
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-routes-"));
        apiRouter = new ApiRouter();
        events = [];
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager(new Set(["session-1"])) as never,
            broadcast: (event) => {
                events.push(event);
            },
            settingsStore: new SettingsStore(join(tempDir, "settings.json")),
            gitService: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("broadcasts explicit session status updates", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/status", {
                method: "POST",
                body: JSON.stringify({ status: "working" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(events).toEqual([
            {
                type: MSG.SESSION_STATUS,
                payload: { sessionId: "session-1", status: "working" },
            },
        ]);
    });

    it("rejects invalid session statuses", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/sessions/session-1/status", {
                method: "POST",
                body: JSON.stringify({ status: "busy" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(400);
        expect(events).toHaveLength(0);
    });

    it("broadcasts project-scoped browser tabs", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/projects/project-1/browser", {
                method: "POST",
                body: JSON.stringify({ url: "https://example.com", label: "Docs" }),
                headers: { "Content-Type": "application/json" },
            }),
        );

        expect(response?.status).toBe(200);
        expect(events).toEqual([
            {
                type: MSG.BROWSER_OPEN,
                payload: { projectId: "project-1", url: "https://example.com", label: "Docs" },
            },
        ]);
    });
});

describe("settings routes", () => {
    let apiRouter: ApiRouter;
    let tempDir: string;
    let settingsStore: SettingsStore;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-api-settings-"));
        settingsStore = new SettingsStore(join(tempDir, "settings.json"));
        apiRouter = new ApiRouter();
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager() as never,
            broadcast: () => {},
            settingsStore,
            gitService: {} as never,
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("GET /api/settings returns defaults", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", { method: "GET" }),
        );
        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);
        const body = (await response?.json()) as AppSettings;
        expect(body.layout.window.width).toBe(1400);
        expect(body.layout.panels.sidebarWidth).toBe(220);
    });

    it("PATCH /api/settings updates and returns full settings", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: JSON.stringify({
                    layout: { window: { width: 1600, height: 1000 } },
                }),
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);
        const body = (await response?.json()) as AppSettings;
        expect(body.layout.window.width).toBe(1600);
        expect(body.layout.window.height).toBe(1000);
        expect(body.layout.window.isMaximized).toBe(false);
    });

    it("PATCH /api/settings rejects invalid JSON", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/settings", {
                method: "PATCH",
                body: "not json",
                headers: { "Content-Type": "application/json" },
            }),
        );
        expect(response?.status).toBe(400);
    });
});
