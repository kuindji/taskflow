import { afterEach, describe, expect, it } from "bun:test";
import { MSG, type AppSettings, type Project } from "@taskflow/shared";
import { registerAgentDiscoveryHandlers } from "../../src/handlers/agent-discovery";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";

const inherited = process.env.CODEX_HOME;
afterEach(() => {
    if (inherited === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = inherited;
});

function setup() {
    const settings = {
        codex: {
            accounts: [
                { id: "global", name: "global-name", homeDir: "/backend/global" },
                { id: "project", name: "project-name", homeDir: "/backend/project" },
                { id: "explicit", name: "explicit-name", homeDir: "/backend/explicit" },
            ],
            defaultAccount: "global",
        },
    } as AppSettings;
    const project: Project = {
        id: "p1",
        name: "p1",
        path: "/backend/p1",
        sessions: [],
        attributes: [],
        createdAt: "",
        agentAccounts: { codex: "project" },
    };
    const environments: Array<Record<string, string | undefined> | undefined> = [];
    const router = new TestRouter();
    let settingsReads = 0;
    registerAgentDiscoveryHandlers({
        router,
        taskStore: { getProject: async (id) => (id === project.id ? project : null) },
        settingsStore: {
            get: async () => {
                settingsReads++;
                return settings;
            },
        },
        fetchCodexModels: async (env) => {
            environments.push(env);
            return { models: [], account: { state: "unknown" } };
        },
    });
    return { router, environments, settings, settingsReads: () => settingsReads };
}

describe("Codex discovery handler", () => {
    it("Codex discovery resolves explicit account before project before global default", async () => {
        const { router, environments } = setup();
        await router.handle(MSG.CODEX_MODELS, { account: "explicit", projectId: "p1" });
        await router.handle(MSG.CODEX_MODELS, { projectId: "p1" });
        await router.handle(MSG.CODEX_MODELS, {});
        await router.handle(MSG.CODEX_MODELS, { account: "explicit-name" });
        await router.handle(MSG.CODEX_MODELS, { account: "inherit", projectId: "p1" });
        expect(environments.map((env) => env?.CODEX_HOME)).toEqual([
            "/backend/explicit",
            "/backend/project",
            "/backend/global",
            "/backend/explicit",
            "/backend/project",
        ]);
    });
    it("Codex default pins the inherited home even when a named account is global default", async () => {
        process.env.CODEX_HOME = "/inherited/codex";
        const { router, environments } = setup();
        await router.handle(MSG.CODEX_MODELS, { account: "default", projectId: "p1" });
        expect(environments[0]?.CODEX_HOME).toBe("/inherited/codex");
    });
    it("Codex discovery uses the receiving backend's settings and preserves inherited CODEX_HOME", async () => {
        process.env.CODEX_HOME = "/inherited/codex";
        const { router, environments, settings, settingsReads } = setup();
        settings.codex.defaultAccount = "default";
        await router.handle(MSG.CODEX_MODELS, {});
        expect(environments[0]?.CODEX_HOME).toBe("/inherited/codex");
        settings.codex.defaultAccount = "explicit";
        await router.handle(MSG.CODEX_MODELS, {});
        expect(environments[1]?.CODEX_HOME).toBe("/backend/explicit");
        expect(settingsReads()).toBe(2);
        expect(environments[0]?.PATH).toBeTruthy();
        expect(environments[0]?.CLAUDECODE).toBeUndefined();
        expect(environments[0]?.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
        expect(process.env.CODEX_HOME).toBe("/inherited/codex");
    });
    it("Codex discovery rejects an unknown project or account before spawning", async () => {
        const { router, environments } = setup();
        await expectRejects(
            router.handle(MSG.CODEX_MODELS, { projectId: "gone" }),
            /Project not found: gone/,
        );
        await expectRejects(
            router.handle(MSG.CODEX_MODELS, { account: "gone" }),
            /Unknown Codex account "gone" \(from launch options\)/,
        );
        expect(environments).toEqual([]);
    });
    it("an omitted Codex discovery payload keeps existing clients working", async () => {
        const { router, environments } = setup();
        expect(await router.handle(MSG.CODEX_MODELS, undefined)).toEqual({
            models: [],
            account: { state: "unknown" },
        });
        await router.handle(MSG.CODEX_MODELS, {});
        expect(environments.map((env) => env?.CODEX_HOME)).toEqual([
            "/backend/global",
            "/backend/global",
        ]);
    });
    it("rejects malformed supplied fields with the discovery request error", async () => {
        const { router, environments } = setup();
        for (const payload of [
            null,
            [],
            "default",
            42,
            { account: null },
            { account: 5 },
            { projectId: false },
            { projectId: null },
        ]) {
            await expectRejects(
                router.handle(MSG.CODEX_MODELS, payload),
                /^Invalid Codex discovery request$/,
            );
        }
        expect(environments).toEqual([]);
    });
});
