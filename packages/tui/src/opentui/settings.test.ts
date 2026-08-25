import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { AppSettings, Project } from "@taskflow/shared";
import { EMPTY_CHOICES } from "../settings/store";
import { optionsWithCurrent, Settings, settingsItems } from "./settings";

function key(name: string, sequence = name): KeyEvent {
    return new KeyEvent({
        name,
        sequence,
        raw: sequence,
        eventType: "press",
        source: "raw",
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        number: false,
    });
}

const settings = {
    general: { defaultAgent: "codex", defaultRuntime: "missing-runtime" },
    terminal: { defaultShell: "system" },
    editor: { externalEditor: "system" },
    layout: { panels: { sidebarWidth: 240, collapsedProjectIds: [] } },
    claude: { defaultModel: "default", permissionMode: "default" },
    codex: {
        defaultModel: "missing-model",
        defaultReasoningEffort: "default",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        dangerouslyBypassApprovalsAndSandbox: false,
    },
    opencode: { defaultModel: "", autoApprove: false },
    pi: { defaultModel: "" },
    kimi: { defaultModel: "", permissionMode: "manual" },
} as unknown as AppSettings;
const project: Project = {
    id: "p1",
    name: "Taskflow",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "",
};
const choices = {
    ...EMPTY_CHOICES,
    agents: [{ value: "codex", label: "Codex" }],
    runtimes: [{ value: "bun", label: "bun 1.4" }],
    shells: [{ value: "system", label: "System default" }],
    editors: [{ value: "system", label: "System default" }],
};

describe("Settings", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("keeps unavailable saved choices visible", () => {
        expect(optionsWithCurrent([{ value: "bun", label: "Bun" }], "node")).toEqual([
            { value: "node", label: "node (unavailable)" },
            { value: "bun", label: "Bun" },
        ]);
        const items = settingsItems(settings, choices, [project]);
        expect(items.find((item) => item.id === "runtime")?.options[0]?.label).toBe(
            "missing-runtime (unavailable)",
        );
        expect(items.find((item) => item.id === "codex-model")?.options[0]?.label).toBe(
            "missing-model (unavailable)",
        );
    });

    test("cycles a typed choice and saves one minimal payload", async () => {
        const test = await createTestRenderer({ width: 90, height: 24 });
        const saves: unknown[] = [];
        const view = new Settings({
            renderer: test.renderer,
            settings,
            choices,
            projects: [project],
            onSave: (item, value) => saves.push(item.payload(value)),
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("down"));
        view.handleKey(key("right"));
        view.handleKey(key("return", "\r"));
        expect(saves).toEqual([{ general: { defaultRuntime: "bun" } }]);
        expect(view.keyHints).toBe(" Saving...");
    });
});
