import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { SystemInfo } from "@taskflow/shared";
import { registerSystemHandlers } from "./system";
import { TestRouter } from "../../tests/test-router";

describe("system handlers", () => {
    it.each([
        [true, "main"],
        [false, "development"],
    ] as const)("reports schedulerEnabled=%s for a %s backend", async (schedulerEnabled) => {
        const router = new TestRouter();
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
            hostname: "test-host",
            protocolVersion: 1,
            backendUid: "0123456789abcdef0123456789abcdef",
        });

        const result = (await router.handle(MSG.SYSTEM_INFO, {})) as SystemInfo;

        expect(result).toEqual({
            editors,
            homedir: "/home/tester",
            schedulerEnabled,
            hostname: "test-host",
            protocolVersion: 1,
            backendUid: "0123456789abcdef0123456789abcdef",
        });
    });
});
