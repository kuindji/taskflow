import { beforeEach, describe, expect, it } from "bun:test";
import { MSG, type WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerApiRoutes } from "../../src/api/routes";

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

    beforeEach(() => {
        apiRouter = new ApiRouter();
        events = [];
        registerApiRoutes({
            apiRouter,
            taskStore: {} as never,
            ptyManager: new FakePtyManager(new Set(["session-1"])) as never,
            broadcast: (event) => {
                events.push(event);
            },
        });
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
});
