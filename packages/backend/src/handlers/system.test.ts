import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { SystemInfo } from "@taskflow/shared";
import { registerSystemHandlers } from "./system";
import { Router } from "../ws/router";

describe("system handlers", () => {
    it.each([
        [true, "main"],
        [false, "development"],
    ] as const)("reports schedulerEnabled=%s for a %s backend", async (schedulerEnabled) => {
        const router = new Router();
        const editors = [
            {
                id: "vim",
                name: "Vim",
                command: "vim",
                type: "external" as const,
            },
        ];

        registerSystemHandlers({
            router,
            editors,
            homedir: "/home/tester",
            schedulerEnabled,
        });

        const result = (await router.handle(MSG.SYSTEM_INFO, {})) as SystemInfo;

        expect(result).toEqual({
            editors,
            homedir: "/home/tester",
            schedulerEnabled,
        });
    });
});
