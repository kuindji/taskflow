import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { BuiltinActionDefinition, BuiltinActionsListResponse } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { FlowStore } from "../../src/services/flow-store";
import { createBuiltinActions } from "../../src/services/builtin-actions";
import { registerBuiltinActionHandlers } from "../../src/handlers/builtin-action";

let tempDir: string;
let router: TestRouter;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-builtin-handler-"));
    const flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "runs"));
    await flowStore.init();
    router = new TestRouter();
    registerBuiltinActionHandlers({ router, builtinActions: createBuiltinActions({ flowStore }) });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

it("lists, saves and resets built-in actions", async () => {
    const listed = (await router.handle(
        MSG.BUILTIN_ACTIONS_LIST,
        {},
    )) as BuiltinActionsListResponse;
    expect(listed.actions).toHaveLength(4);

    const saved = (await router.handle(MSG.BUILTIN_ACTION_SAVE, {
        id: "builtin:schedule-name",
        prompt: "Name: {{prompt}}",
        sessionType: "claude",
        updatedAt: "x",
    })) as BuiltinActionDefinition;
    expect(saved.isModified).toBe(true);

    const reset = (await router.handle(MSG.BUILTIN_ACTION_RESET, {
        id: "builtin:schedule-name",
    })) as BuiltinActionDefinition;
    expect(reset.isModified).toBe(false);
});

it("rejects a reset for an unknown id", async () => {
    await expect(router.handle(MSG.BUILTIN_ACTION_RESET, { id: "nope" })).rejects.toThrow(
        /Unknown built-in action/,
    );
});
