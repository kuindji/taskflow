import { expect, test } from "bun:test";
import { MSG } from "@taskflow/shared";
import { loadCodexDiscovery } from "./agent-discovery";

test("an older backend's Codex answer without account diagnostics reads as unknown", async () => {
    const response = await loadCodexDiscovery("remote", { account: "work" }, async () => ({
        models: [],
    }));
    expect(response).toEqual({ models: [], account: { state: "unknown" } });
});

test("Codex discovery drops an inherited account from the request", async () => {
    const sent: unknown[] = [];
    const response = await loadCodexDiscovery(
        "local",
        { account: "inherit", projectId: "p1" },
        async (backendId, type, payload) => {
            sent.push([backendId, type, payload]);
            return { models: [], account: { state: "signed-out" } };
        },
    );
    expect(sent).toEqual([["local", MSG.CODEX_MODELS, { projectId: "p1" }]]);
    expect(response.account).toEqual({ state: "signed-out" });
});
