import { describe, expect, it } from "bun:test";
import type { ActionDefinition, Schedule } from "@taskflow/shared";
import {
    actionRecord,
    flowRecord,
    parseActionDraft,
    parseFlowDraft,
    parseScheduleDraft,
    schedulePayload,
    serializeAction,
    serializeFlow,
    serializeSchedule,
} from "./records";

const now = "2026-08-25T12:00:00.000Z";
const visibleAction: ActionDefinition = {
    id: "action-1",
    projectId: "p1",
    name: "Build",
    prompt: "bun run build",
    sessionType: "shell",
    standalone: true,
    createdAt: now,
    updatedAt: now,
};
const context = { projectId: "p1", visibleActions: [visibleAction] };
const metadata = { now: () => now, uuid: () => "generated-id" };

describe("record YAML", () => {
    it("validates action fields and agent option type matching", () => {
        const draft = parseActionDraft(
            "projectId: p1\nname: Review\nprompt: Check it\nsessionType: codex\nagentOptions:\n  type: codex\n  reasoningEffort: high\nstandalone: true\n",
            context,
        );
        expect(draft.agentOptions).toEqual({ type: "codex", reasoningEffort: "high" });
        expect(() =>
            parseActionDraft(
                "projectId: p1\nname: Review\nprompt: Check it\nsessionType: codex\nagentOptions:\n  type: claude\n",
                context,
            ),
        ).toThrow("must match sessionType");
        expect(() =>
            parseActionDraft(
                "projectId: p1\nname: Review\nprompt: Check it\nsessionType: shell\ntypo: true\n",
                context,
            ),
        ).toThrow('unknown key "typo"');
    });

    it("validates flow IDs, inputs, action references, and inline actions", () => {
        const draft = parseFlowDraft(
            "projectId: p1\nname: Release\ndescription: Ship it\ninputs:\n  - id: target\n    label: Target\n    type: filepath\nactions:\n  - id: build\n    actionId: action-1\n  - id: verify\n    inline:\n      name: Verify\n      prompt: bun test\n      sessionType: shell\n",
            context,
        );
        expect(draft.actions).toHaveLength(2);
        expect(draft.inputs?.[0]?.type).toBe("filepath");
        expect(() =>
            parseFlowDraft(
                "projectId: p1\nname: Bad\ndescription: ''\nactions:\n  - id: one\n    actionId: missing\n",
                context,
            ),
        ).toThrow("not visible");
        expect(() =>
            parseFlowDraft(
                "projectId: p1\nname: Bad\ndescription: ''\ninputs:\n  - {id: same, label: A, type: text}\n  - {id: same, label: B, type: text}\nactions:\n  - {id: one, actionId: action-1}\n",
                context,
            ),
        ).toThrow('duplicate id "same"');
    });

    it("requires one runnable schedule source and a project on create", () => {
        const draft = parseScheduleDraft(
            "projectId: p1\nname: Nightly\nactionId: action-1\nexpression: '0 2 * * *'\nexpressionType: cron\ntimeout: 30\nenabled: false\n",
            context,
            true,
        );
        expect(draft.actionId).toBe("action-1");
        expect(() =>
            parseScheduleDraft(
                "projectId: p1\nname: Bad\nprompt: echo ok\nactionId: action-1\nexpression: 5m\nexpressionType: rate\ntimeout: 30\nenabled: false\n",
                context,
                true,
            ),
        ).toThrow("exactly one");
        expect(() =>
            parseScheduleDraft(
                "name: Bad\nprompt: echo ok\nexpression: 5m\nexpressionType: rate\ntimeout: 30\nenabled: false\n",
                { ...context, projectId: null },
                true,
            ),
        ).toThrow("projectId is required");
    });

    it("owns IDs and timestamps and emits full schedule updates with null clearing", () => {
        const actionDraft = parseActionDraft(
            "projectId: p1\nname: Build\nprompt: bun run build\nsessionType: shell\n",
            context,
        );
        expect(actionRecord(actionDraft, undefined, metadata)).toMatchObject({
            id: "generated-id",
            createdAt: now,
            updatedAt: now,
        });
        const flowDraft = parseFlowDraft(
            "projectId: p1\nname: Flow\ndescription: ''\nactions:\n  - {id: build, actionId: action-1}\n",
            context,
        );
        expect(flowRecord(flowDraft, undefined, metadata).id).toBe("generated-id");

        const existing: Schedule = {
            id: "schedule-1",
            projectId: "p1",
            name: "Old",
            prompt: "old",
            actionId: "action-1",
            agentType: "codex",
            agentOptions: { type: "codex", model: "old" },
            expression: "5m",
            expressionType: "rate",
            timeout: 30,
            enabled: false,
            lastRunAt: null,
            lastError: null,
            nextRunAt: null,
            runningSessionId: null,
            createdAt: now,
            updatedAt: now,
        };
        const draft = parseScheduleDraft(
            "name: Updated\nprompt: echo ok\nexpression: 10m\nexpressionType: rate\ntimeout: 45\nenabled: false\n",
            context,
            false,
        );
        expect(schedulePayload(draft, existing)).toEqual({
            id: "schedule-1",
            name: "Updated",
            prompt: "echo ok",
            actionId: null,
            agentType: null,
            agentOptions: null,
            expression: "10m",
            expressionType: "rate",
            timeout: 45,
            enabled: false,
        });
    });

    it("serializes stable YAML comments without immutable metadata", () => {
        const actionYaml = serializeAction(visibleAction);
        expect(actionYaml).toContain("# sessionType and agentType:");
        expect(actionYaml).not.toContain("createdAt");
        expect(
            serializeFlow(
                flowRecord(
                    parseFlowDraft(
                        "projectId: p1\nname: Flow\ndescription: ''\nactions:\n  - {id: build, actionId: action-1}\n",
                        context,
                    ),
                    undefined,
                    metadata,
                ),
                [visibleAction],
            ),
        ).toContain("# action action-1: Build");
        expect(
            serializeSchedule(
                {
                    projectId: "p1",
                    name: "New",
                    prompt: "echo ok",
                    expression: "5m",
                    expressionType: "rate",
                    timeout: 30,
                    enabled: false,
                },
                true,
            ),
        ).toContain("projectId: p1");
    });
});
