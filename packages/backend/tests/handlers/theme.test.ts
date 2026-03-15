import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { registerThemeHandlers } from "../../src/handlers/theme";
import { ThemeService } from "../../src/services/theme-service";
import { Router } from "../../src/ws/router";

describe("theme handlers", () => {
    let tempDir: string;
    let router: Router;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-theme-handler-"));
        router = new Router();
        const service = new ThemeService(tempDir);
        registerThemeHandlers(router, service);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("rejects invalid import payloads", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(
            router.handle(MSG.THEME_IMPORT, {
                theme: {
                    name: "Bad Payload",
                },
            }),
        ).rejects.toThrow("Invalid theme source");
    });

    it("rejects invalid delete payloads", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(
            router.handle(MSG.THEME_DELETE, {
                id: "../../etc/passwd",
            }),
        ).rejects.toThrow("Invalid theme id");
    });
});
