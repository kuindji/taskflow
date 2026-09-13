import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { readFile } from "fs/promises";
import { join } from "path";
import { registerBackendReset, registeredResetNames, resetBackend } from "./store-reset";

/** `packages/ui/src`. */
const UI_SRC = join(import.meta.dir, "..");

describe("store reset registry", () => {
    test("passes the backend id to every reset and calls each once", () => {
        const calls: string[] = [];
        registerBackendReset("alpha", (id) => calls.push(`alpha:${id}`));
        registerBackendReset("beta", (id) => calls.push(`beta:${id}`));

        resetBackend("desktop");

        expect(calls).toEqual(["alpha:desktop", "beta:desktop"]);
    });

    test("registering the same name twice replaces rather than duplicates", () => {
        const calls: string[] = [];
        registerBackendReset("gamma", () => calls.push("first"));
        registerBackendReset("gamma", () => calls.push("second"));
        resetBackend("x");
        expect(calls.filter((c) => c.startsWith("first"))).toHaveLength(0);
    });

    test("every module that talks to a backend registers a reset", async () => {
        // Deliberately NOT a hand-written list. A hardcoded `required` array is
        // green on the day it is written and stays green for every store nobody
        // thought of, which is exactly the failure it exists to prevent. The
        // filesystem is the source of truth.
        const roots = ["stores", "hooks", "lib"];
        const suspects: string[] = [];
        for (const root of roots) {
            for (const file of new Glob("**/*.ts").scanSync({ cwd: join(UI_SRC, root) })) {
                if (file.endsWith(".test.ts")) continue;
                const source = await readFile(join(UI_SRC, root, file), "utf-8");
                const talksToBackend = /\bsendRequest\b|\bonEvent\b/.test(source);
                const registers = /registerBackendReset\(|createPerBackendCache\(/.test(source);
                if (talksToBackend && !registers) suspects.push(`src/${root}/${file}`);
            }
        }

        // Anything genuinely stateless goes here, with the reason. Adding to it
        // is a decision someone makes on purpose, in a diff, rather than an
        // omission nobody notices.
        const STATELESS = new Set<string>([
            // The machinery itself: these define sendRequest/onEvent, or call resetBackend.
            "src/lib/connection.ts",
            "src/lib/connection-registry.ts",
            "src/stores/backend-store.ts",
            // Forwards to the registry and holds nothing; deleted in Task 19.
            "src/hooks/useWebSocket.ts",
            // Writes that return nothing it keeps.
            "src/lib/attribute-api.ts",
            // Asks for the shell list per launch; nothing kept between calls.
            "src/lib/run-in-shell.ts",
            // Asks per menu open; nothing kept between calls.
            "src/lib/wiki/open-in-obsidian.ts",
            // Component state only, refetched on mount.
            "src/hooks/useRemoteAgentStatus.ts",
            // Component state only; requests carry the row's machine.
            "src/hooks/useRunMenu.ts",
            // Routes events into session-store and session-activity, which register the resets.
            "src/stores/session-subscriptions.ts",
        ]);

        expect(suspects.filter((s) => !STATELESS.has(s))).toEqual([]);
    });

    test("resets are keyed, so registering twice replaces", () => {
        expect(new Set(registeredResetNames()).size).toBe(registeredResetNames().length);
    });
});
