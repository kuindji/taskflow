import { afterEach, expect, it } from "bun:test";
import { ApiRouter } from "../../src/api/router";
import { Router } from "../../src/ws/router";
import { createServer } from "../../src/ws/server";

const TOKEN = "test-token";
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

it("task deletion outlasts the default HTTP idle timeout", async () => {
    const apiRouter = new ApiRouter();
    // Worktree cleanup runs before the reply. Bun drops a request idle for 10 s, checked coarsely.
    apiRouter.register("DELETE", "/api/tasks/:taskId", async () => {
        await Bun.sleep(15_000);
        return Response.json({ success: true });
    });
    const running = await createServer(new Router(), 0, apiRouter, undefined, {
        token: TOKEN,
        allowedOrigins: new Set(),
    }).start();
    cleanups.push(() => running.stop());

    // curl, as the sh CLI uses it; Bun's own fetch hides the dropped reply.
    const curl = Bun.spawn(
        [
            "curl",
            "-sS",
            "-X",
            "DELETE",
            "-H",
            `Authorization: Bearer ${TOKEN}`,
            "-w",
            "\n%{http_code}",
            `http://127.0.0.1:${running.port}/api/tasks/t1`,
        ],
        { stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(curl.stdout).text();

    expect(output).toBe('{"success":true}\n200');
}, 25_000);
