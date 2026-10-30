import { describe, it, expect } from "bun:test";
import {
    fetchCodexModels,
    fetchPiModels,
    detectRuntimes,
    detectAgents,
    parseCodexAppServerOutput,
    parsePiModelsOutput,
    parseKimiModelsOutput,
} from "../../src/services/runtime-detector";

describe("detectRuntimes", () => {
    it("returns at least one runtime on a dev machine", async () => {
        const runtimes = await detectRuntimes();
        expect(runtimes.length).toBeGreaterThan(0);
    });

    it("detects bun when running under bun", async () => {
        const runtimes = await detectRuntimes();
        const bun = runtimes.find((r) => r.name === "bun");
        expect(bun).toBeDefined();
        expect(bun?.path).toBeTruthy();
        expect(bun?.version).not.toBe("unknown");
    });

    it("returns name, path, and version for each runtime", async () => {
        const runtimes = await detectRuntimes();
        for (const rt of runtimes) {
            expect(rt.name).toBeTruthy();
            expect(rt.path).toBeTruthy();
            expect(typeof rt.version).toBe("string");
        }
    });
});

describe("detectAgents", () => {
    it(
        "returns an entry for each known agent type",
        async () => {
            const agents = await detectAgents();
            const types = agents.map((a) => a.type);
            expect(types).toContain("claude");
            expect(types).toContain("codex");
        },
        { timeout: 15000 },
    );

    it(
        "returns correct shape for each agent",
        async () => {
            const agents = await detectAgents();
            for (const agent of agents) {
                expect(typeof agent.type).toBe("string");
                expect(typeof agent.available).toBe("boolean");
                expect(typeof agent.path).toBe("string");
                expect(typeof agent.version).toBe("string");
                if (agent.available) {
                    expect(agent.path).toBeTruthy();
                } else {
                    expect(agent.path).toBe("");
                }
            }
        },
        { timeout: 15000 },
    );
});

describe("parsePiModelsOutput", () => {
    const FIXTURE = [
        "provider      model                context  max-out  thinking  images",
        "openai-codex  gpt-5.1              272K     128K     yes       yes   ",
        "openai-codex  gpt-5.3-codex-spark  128K     128K     yes       no    ",
        "anthropic     claude-sonnet-4.5    200K     64K      no        yes   ",
    ].join("\n");

    it("parses columns into PiModelInfo objects and skips the header", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models).toHaveLength(3);
        expect(models[0]).toEqual({
            provider: "openai-codex",
            id: "gpt-5.1",
            contextWindow: "272K",
            maxOutput: "128K",
            supportsThinking: true,
            supportsImages: true,
        });
    });

    it("converts yes/no columns to booleans", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models[1].supportsThinking).toBe(true);
        expect(models[1].supportsImages).toBe(false);
        expect(models[2].supportsThinking).toBe(false);
        expect(models[2].supportsImages).toBe(true);
    });

    it("returns empty array for empty input", () => {
        expect(parsePiModelsOutput("")).toEqual([]);
        expect(parsePiModelsOutput("   \n   ")).toEqual([]);
    });

    it("returns empty array for header-only input", () => {
        expect(parsePiModelsOutput("provider  model  context  max-out  thinking  images")).toEqual(
            [],
        );
    });
});

describe("parseCodexAppServerOutput", () => {
    const FIXTURE = [
        JSON.stringify({ id: 1, result: { userAgent: "taskflow/0.1" } }),
        JSON.stringify({ method: "account/updated", params: {} }),
        JSON.stringify({
            id: 2,
            result: {
                data: [
                    {
                        id: "gpt-5.6-sol",
                        model: "gpt-5.6-sol",
                        displayName: "GPT-5.6-Sol",
                        description: "Latest frontier agentic coding model.",
                        hidden: false,
                        supportedReasoningEfforts: [
                            { reasoningEffort: "low", description: "Fast" },
                            { reasoningEffort: "high", description: "Deep" },
                        ],
                        defaultReasoningEffort: "low",
                        inputModalities: ["text", "image"],
                        isDefault: true,
                    },
                ],
                nextCursor: null,
            },
        }),
    ].join("\n");

    it("extracts normalized models from the model/list response", () => {
        expect(parseCodexAppServerOutput(FIXTURE)).toEqual([
            {
                id: "gpt-5.6-sol",
                model: "gpt-5.6-sol",
                displayName: "GPT-5.6-Sol",
                description: "Latest frontier agentic coding model.",
                hidden: false,
                supportedReasoningEfforts: [
                    { reasoningEffort: "low", description: "Fast" },
                    { reasoningEffort: "high", description: "Deep" },
                ],
                defaultReasoningEffort: "low",
                inputModalities: ["text", "image"],
                isDefault: true,
            },
        ]);
    });

    it("ignores malformed lines and unknown reasoning efforts", () => {
        const output = [
            "not json",
            JSON.stringify({
                id: 2,
                result: {
                    data: [
                        {
                            id: "future-model",
                            supportedReasoningEfforts: [
                                { reasoningEffort: "future", description: "Unknown" },
                                { reasoningEffort: "medium", description: "Supported" },
                            ],
                            defaultReasoningEffort: "future",
                        },
                    ],
                },
            }),
        ].join("\n");

        const models = parseCodexAppServerOutput(output);
        expect(models[0]?.supportedReasoningEfforts).toEqual([
            { reasoningEffort: "medium", description: "Supported" },
        ]);
        expect(models[0]?.defaultReasoningEffort).toBe("medium");
    });
});

describe("parseKimiModelsOutput", () => {
    const FIXTURE = JSON.stringify({
        providers: { "managed:kimi-code": { type: "kimi" } },
        models: {
            "kimi-code/kimi-for-coding": {
                provider: "managed:kimi-code",
                model: "kimi-for-coding",
                maxContextSize: 262144,
                capabilities: ["thinking", "tool_use"],
                displayName: "K2.7 Coding",
            },
            "kimi-code/k3": {
                provider: "managed:kimi-code",
                model: "k3",
                maxContextSize: 262144,
                displayName: "K3",
            },
        },
    });

    it("parses the models map into KimiModelInfo entries", () => {
        const models = parseKimiModelsOutput(FIXTURE);
        expect(models).toHaveLength(2);
        expect(models[0]).toEqual({
            id: "kimi-code/kimi-for-coding",
            displayName: "K2.7 Coding",
            contextWindow: "256K",
        });
        expect(models[1]).toEqual({ id: "kimi-code/k3", displayName: "K3", contextWindow: "256K" });
    });

    it("falls back to the model field, then the alias id, when displayName is missing", () => {
        const withModel = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/x": { model: "x", maxContextSize: 131072 } } }),
        );
        expect(withModel).toEqual([{ id: "kimi-code/x", displayName: "x", contextWindow: "128K" }]);
        const bare = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/y": { maxContextSize: 131072 } } }),
        );
        expect(bare).toEqual([
            { id: "kimi-code/y", displayName: "kimi-code/y", contextWindow: "128K" },
        ]);
    });

    it("returns empty for malformed JSON, non-object, missing models, and array models", () => {
        expect(parseKimiModelsOutput("not json")).toEqual([]);
        expect(parseKimiModelsOutput('"str"')).toEqual([]);
        expect(parseKimiModelsOutput("{}")).toEqual([]);
        expect(parseKimiModelsOutput("")).toEqual([]);
        // an array `models` must not be indexed by numeric keys ("0", "1", ...)
        expect(parseKimiModelsOutput(JSON.stringify({ models: [{ model: "x" }] }))).toEqual([]);
    });

    it("omits contextWindow when maxContextSize is absent or invalid", () => {
        const models = parseKimiModelsOutput(
            JSON.stringify({
                models: { "kimi-code/y": { displayName: "Y", maxContextSize: "big" } },
            }),
        );
        expect(models).toEqual([{ id: "kimi-code/y", displayName: "Y", contextWindow: "" }]);
    });
});

type ProbeDeps = NonNullable<Parameters<typeof fetchCodexModels>[1]>;
type Message = {
    id?: number | string;
    method?: string;
    type?: string;
    params?: Record<string, unknown>;
};

function codexProbe(reply: (request: Message) => unknown, cli = "codex") {
    let stdout!: ReadableStreamDefaultController<Uint8Array>;
    let stderr!: ReadableStreamDefaultController<Uint8Array>;
    const requests: Message[] = [];
    const spawns: Array<{ argv: string[]; env: Record<string, string | undefined>; cwd?: string }> =
        [];
    let deadline: (() => void) | undefined;
    let deadlines = 0;
    let cancelled = 0;
    let killed = 0;
    let ended = 0;
    let streamsCancelled = 0;
    const emit = (value: unknown) => {
        const text = JSON.stringify(value) + "\n";
        const bytes = new TextEncoder().encode(text);
        stdout.enqueue(bytes.slice(0, 7));
        stdout.enqueue(bytes.slice(7));
    };
    const deps: ProbeDeps = {
        resolveCli: (name, path) => {
            expect(name).toBe(cli);
            expect(path).toBe("/probe/bin");
            return `/probe/bin/${cli}`;
        },
        spawn: (argv, options) => {
            spawns.push({ argv, ...options });
            return {
                stdout: new ReadableStream({
                    start(c) {
                        stdout = c;
                    },
                    cancel() {
                        streamsCancelled++;
                    },
                }),
                stderr: new ReadableStream({
                    start(c) {
                        stderr = c;
                    },
                    cancel() {
                        streamsCancelled++;
                    },
                }),
                async write(line) {
                    const request = JSON.parse(line) as Message;
                    requests.push(request);
                    const response = reply(request);
                    if (response !== undefined) emit(response);
                },
                end() {
                    ended++;
                    return new Promise<void>(() => {});
                },
                exited: new Promise<number>(() => {}),
                kill() {
                    killed++;
                },
            };
        },
        schedule: (callback, ms) => {
            expect(ms).toBe(60_000);
            deadlines++;
            deadline = callback;
            return () => {
                cancelled++;
            };
        },
    };
    return {
        deps,
        requests,
        spawns,
        emit,
        timeout: () => deadline?.(),
        stderr: (value: string) => stderr.enqueue(new TextEncoder().encode(value)),
        closed: () => ({ deadlines, cancelled, killed, ended, streamsCancelled }),
    };
}

function codexReplies(account: unknown = { type: "chatgpt", email: "person@example.com" }) {
    return (request: Message): unknown => {
        if (request.method === "initialize") return { id: request.id, result: {} };
        if (request.method === "account/read") return { id: request.id, result: { account } };
        if (request.method === "model/list")
            return { id: request.id, result: { data: [{ id: "one" }] } };
    };
}

async function discover(probe: ReturnType<typeof codexProbe>, env = { PATH: "/probe/bin" }) {
    return fetchCodexModels(env, probe.deps);
}

describe("Codex RPC discovery", () => {
    it("Codex discovery follows every nextCursor and filters hidden models", async () => {
        const base = codexReplies();
        const probe = codexProbe((request) =>
            request.method !== "model/list"
                ? base(request)
                : {
                      id: request.id,
                      result:
                          request.params?.cursor === "page-two"
                              ? {
                                    data: [{ id: "visible" }, { id: "hidden", hidden: true }],
                                    nextCursor: "",
                                }
                              : { data: [{ id: "first" }], nextCursor: "page-two" },
                  },
        );
        expect((await discover(probe)).models.map((model) => model.id)).toEqual([
            "first",
            "visible",
        ]);
        expect(
            probe.requests.filter((r) => r.method === "model/list").map((r) => r.params),
        ).toEqual([{}, { cursor: "page-two" }]);
        expect(probe.spawns).toEqual([
            {
                argv: ["/probe/bin/codex", "app-server", "--listen", "stdio://"],
                env: { PATH: "/probe/bin" },
            },
        ]);
    });
    it("Codex discovery preserves page order and deduplicates model ids", async () => {
        const base = codexReplies();
        const probe = codexProbe((request) =>
            request.method !== "model/list"
                ? base(request)
                : {
                      id: request.id,
                      result: request.params?.cursor
                          ? { data: [{ id: "a", displayName: "later" }, { id: "c" }] }
                          : {
                                data: [{ id: "b" }, { id: "a", displayName: "first" }],
                                nextCursor: "next",
                            },
                  },
        );
        const result = await discover(probe);
        expect(result.models.map((model) => model.id)).toEqual(["b", "a", "c"]);
        expect(result.models[1].displayName).toBe("first");
    });
    it("Codex discovery matches response ids across chunks and notifications", async () => {
        const base = codexReplies();
        const probe = codexProbe((request) => {
            if (request.id) {
                probe.emit({ id: 999, result: { data: [{ id: "wrong" }] } });
                probe.emit({ method: "account/updated", params: {} });
                probe.stderr("unreturned diagnostic\n");
            }
            return base(request);
        });
        expect((await discover(probe)).models.map((model) => model.id)).toEqual(["one"]);
        expect(probe.requests.map((r) => r.id).filter((id) => id !== undefined)).toEqual([1, 2, 3]);
        expect(probe.requests[0]).toEqual({
            method: "initialize",
            id: 1,
            params: { clientInfo: { name: "taskflow", title: "Taskflow", version: "1" } },
        });
    });
    it("Codex discovery passes the supplied CODEX_HOME without changing process.env", async () => {
        const before = { ...process.env };
        const probe = codexProbe(codexReplies());
        const env = { PATH: "/probe/bin", CODEX_HOME: "/saved/account" };
        await discover(probe, env);
        expect(probe.spawns[0].env).toEqual(env);
        expect(process.env).toEqual(before);
    });
    it("Codex discovery reads account status without login or token refresh", async () => {
        const probe = codexProbe(codexReplies());
        const result = await discover(probe);
        expect(result.account).toEqual({ state: "signed-in", label: "person@example.com" });
        expect(probe.requests.map((r) => r.method)).toEqual([
            "initialize",
            "initialized",
            "account/read",
            "model/list",
        ]);
        expect(probe.requests[1]).toEqual({ method: "initialized", params: {} });
        expect(probe.requests[2].params).toEqual({});
    });
    it("Codex account diagnostics distinguish ChatGPT, API key, Bedrock and signed out", async () => {
        for (const [account, expected] of [
            [
                { type: "chatgpt", email: " " },
                { state: "signed-in", label: "ChatGPT" },
            ],
            [
                { type: "apiKey", token: "secret" },
                { state: "signed-in", label: "API key" },
            ],
            [{ type: "amazonBedrock" }, { state: "signed-in", label: "Amazon Bedrock" }],
            [null, { state: "signed-out" }],
            [{ type: "future" }, { state: "unknown" }],
        ] as const) {
            expect((await discover(codexProbe(codexReplies(account)))).account).toEqual(expected);
        }
    });
    it("Codex protocol failure is unknown rather than signed out", async () => {
        for (const result of [{}, { account: false }, { account: [] }]) {
            const base = codexReplies();
            const probe = codexProbe((request) =>
                request.method === "account/read" ? { id: request.id, result } : base(request),
            );
            expect((await discover(probe)).account).toEqual({ state: "unknown" });
        }
        const base = codexReplies();
        const failedAccount = codexProbe((request) =>
            request.method === "account/read"
                ? { id: request.id, error: { message: "unavailable" } }
                : base(request),
        );
        const failedAccountResult = await discover(failedAccount);
        expect(failedAccountResult.account).toEqual({ state: "unknown" });
        expect(failedAccountResult.models.map((model) => model.id)).toEqual(["one"]);
        const probe = codexProbe((request) => ({ id: request.id, error: { message: "failed" } }));
        expect(await discover(probe)).toEqual({ models: [], account: { state: "unknown" } });
        expect(await fetchCodexModels({ PATH: "/missing" }, { resolveCli: () => null })).toEqual({
            models: [],
            account: { state: "unknown" },
        });
    });
    it("a failed page or repeated cursor never returns a partial model inventory", async () => {
        for (const later of [
            { error: { message: "failed" } },
            { result: {} },
            { result: { data: [], nextCursor: "repeat" } },
            { result: { data: [], nextCursor: 1 } },
        ]) {
            const base = codexReplies();
            const probe = codexProbe((request) =>
                request.method !== "model/list"
                    ? base(request)
                    : {
                          id: request.id,
                          ...(request.params?.cursor
                              ? later
                              : { result: { data: [{ id: "partial" }], nextCursor: "repeat" } }),
                      },
            );
            expect((await discover(probe)).models).toEqual([]);
        }
    });
    it("a failed model inventory retains an already read account diagnostic", async () => {
        const base = codexReplies();
        const probe = codexProbe((request) =>
            request.method === "model/list" ? { id: request.id, error: {} } : base(request),
        );
        expect(await discover(probe)).toEqual({
            models: [],
            account: { state: "signed-in", label: "person@example.com" },
        });
    });
    it("the whole Codex probe has one deadline and always releases its child", async () => {
        for (const mode of ["success", "initialize", "model/list", "write-error"]) {
            const base = codexReplies();
            const probe = codexProbe((request) => {
                if (mode === "write-error") throw new Error("write failed");
                if (request.method === mode) {
                    probe.timeout();
                    return undefined;
                }
                return base(request);
            });
            const result = await discover(probe);
            expect(probe.closed()).toEqual({
                deadlines: 1,
                cancelled: 1,
                killed: 1,
                ended: 1,
                streamsCancelled: 2,
            });
            if (mode === "model/list") expect(result.account.state).toBe("signed-in");
            if (mode === "initialize")
                expect(result).toEqual({ models: [], account: { state: "unknown" } });
        }
    });
});

const rawPiModel = {
    provider: "custom",
    id: "reasoner",
    contextWindow: 272000,
    maxTokens: 1000000,
    reasoning: true,
    input: ["text", "image"],
    thinkingLevelMap: { xhigh: "extended" },
    headers: { secret: "hidden" },
};
function piReplies(request: Message): unknown {
    return {
        type: "response",
        id: request.id,
        command: request.type,
        success: true,
        data:
            request.type === "get_state"
                ? { model: rawPiModel }
                : {
                      models: [
                          rawPiModel,
                          rawPiModel,
                          {},
                          { ...rawPiModel, id: "plain", thinkingLevelMap: undefined },
                      ],
                  },
    };
}
describe("Pi RPC discovery", () => {
    it("Pi RPC discovery reads resolved model thinkingLevelMap values", async () => {
        const probe = codexProbe(piReplies, "pi");
        const result = await fetchPiModels(
            { env: { PATH: "/probe/bin", PI_CODING_AGENT_DIR: "/pi-home" }, cwd: "/project" },
            probe.deps,
        );
        expect(result.models).toEqual([
            {
                provider: "custom",
                id: "reasoner",
                contextWindow: "272K",
                maxOutput: "1M",
                supportsThinking: true,
                supportsImages: true,
                supportsXhigh: true,
            },
            {
                provider: "custom",
                id: "plain",
                contextWindow: "272K",
                maxOutput: "1M",
                supportsThinking: true,
                supportsImages: true,
                supportsXhigh: false,
            },
        ]);
        expect(probe.spawns).toEqual([
            {
                argv: ["/probe/bin/pi", "--mode", "rpc", "--no-session"],
                env: { PATH: "/probe/bin", PI_CODING_AGENT_DIR: "/pi-home" },
                cwd: "/project",
            },
        ]);
        expect(JSON.stringify(result)).not.toContain("secret");
    });
    it("Pi default discovery cleans nested-session markers without changing process.env", async () => {
        const before = {
            CLAUDECODE: process.env.CLAUDECODE,
            CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
        };
        process.env.CLAUDECODE = "parent";
        process.env.CLAUDE_CODE_ENTRYPOINT = "parent-entry";
        try {
            const probe = codexProbe(piReplies, "pi");
            await fetchPiModels(undefined, {
                ...probe.deps,
                resolveCli: (name, path) => {
                    expect(name).toBe("pi");
                    expect(path.length).toBeGreaterThan(0);
                    return "/probe/bin/pi";
                },
            });
            expect(probe.spawns[0].env.CLAUDECODE).toBeUndefined();
            expect(probe.spawns[0].env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
            expect(process.env.CLAUDECODE).toBe("parent");
            expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe("parent-entry");
        } finally {
            for (const [key, value] of Object.entries(before)) {
                if (value === undefined) Reflect.deleteProperty(process.env, key);
                else process.env[key] = value;
            }
        }
    });
    it("Pi discovery reads the default full model key from get_state", async () => {
        const probe = codexProbe(piReplies, "pi");
        expect(
            (await fetchPiModels({ env: { PATH: "/probe/bin" } }, probe.deps)).defaultModel,
        ).toBe("custom/reasoner");
        const failed = codexProbe(
            (r) =>
                r.type === "get_state"
                    ? { type: "response", id: r.id, command: r.type, success: false }
                    : piReplies(r),
            "pi",
        );
        const result = await fetchPiModels({ env: { PATH: "/probe/bin" } }, failed.deps);
        expect(result.models).toHaveLength(2);
        expect(result.defaultModel).toBeUndefined();
    });
    it("Pi discovery correlates response ids and never sends a prompt", async () => {
        const probe = codexProbe((r) => {
            probe.emit({
                type: "response",
                id: "wrong",
                command: r.type,
                success: true,
                data: { models: [] },
            });
            probe.emit({
                type: "response",
                id: r.id,
                command: "wrong",
                success: true,
                data: { models: [] },
            });
            if (r.type === "get_state") return;
            probe.emit(piReplies(r));
            probe.emit(piReplies({ id: "taskflow-state", type: "get_state" }));
        }, "pi");
        const result = await fetchPiModels({ env: { PATH: "/probe/bin" } }, probe.deps);
        expect(result.defaultModel).toBe("custom/reasoner");
        expect(probe.requests).toEqual([
            { id: "taskflow-state", type: "get_state" },
            { id: "taskflow-models", type: "get_available_models" },
        ]);
    });
    it("Pi RPC failure falls back to table models without claiming xhigh support", async () => {
        const probe = codexProbe(
            (r) => ({ type: "response", id: r.id, command: r.type, success: false }),
            "pi",
        );
        let now = 100;
        const spawn = probe.deps.spawn!;
        const schedules: number[] = [];
        const env = { PATH: "/probe/bin", PI_CODING_AGENT_DIR: "/home/pi" };
        const result = await fetchPiModels(
            { env, cwd: "/repo" },
            {
                ...probe.deps,
                now: () => now,
                schedule: (_fn, ms) => {
                    schedules.push(ms);
                    return () => {};
                },
                spawn: (argv, options) => {
                    if (argv.includes("--mode")) {
                        now += 500;
                        return spawn(argv, options);
                    }
                    expect(argv).toEqual(["/probe/bin/pi", "--list-models"]);
                    expect(options).toEqual({ env, cwd: "/repo" });
                    return {
                        stdout: new ReadableStream({
                            start(c) {
                                c.close();
                            },
                        }),
                        stderr: new ReadableStream({
                            start(c) {
                                c.enqueue(
                                    new TextEncoder().encode(
                                        "provider  model  context  max-out  thinking  images\ncustom  legacy  128K  64K  yes  no\n",
                                    ),
                                );
                                c.close();
                            },
                        }),
                        write: async () => {},
                        end: async () => {},
                        kill: () => {},
                        exited: Promise.resolve(0),
                    };
                },
            },
        );
        expect(result).toEqual({
            models: [
                {
                    provider: "custom",
                    id: "legacy",
                    contextWindow: "128K",
                    maxOutput: "64K",
                    supportsThinking: true,
                    supportsImages: false,
                },
            ],
        });
        expect(schedules).toEqual([60000, 59500]);
    });
    it("Pi discovery has one deadline and releases the ephemeral process", async () => {
        const probe = codexProbe(() => undefined, "pi");
        const result = fetchPiModels(
            { env: { PATH: "/probe/bin" } },
            { ...probe.deps, now: () => 0 },
        );
        probe.timeout();
        expect(await result).toEqual({ models: [] });
        await Promise.resolve();
        expect(probe.spawns).toHaveLength(1);
        expect(probe.closed()).toEqual({
            deadlines: 1,
            cancelled: 1,
            killed: 1,
            ended: 1,
            streamsCancelled: 2,
        });
    });
});
