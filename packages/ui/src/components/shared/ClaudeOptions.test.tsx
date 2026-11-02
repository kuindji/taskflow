import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ClaudeSettings } from "@taskflow/shared";
import { ClaudeOptions } from "./ClaudeOptions";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(props: {
    mode?: "defaults" | "session";
    headless?: boolean;
    settings?: ClaudeSettings | null;
}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <ClaudeOptions
                modelValue="default"
                effortValue="default"
                permissionMode="default"
                onModelChange={() => {}}
                onEffortChange={() => {}}
                onPermissionModeChange={() => {}}
                {...props}
            />,
        );
    });
}

function triggers(): (string | null)[] {
    return [...(container?.querySelectorAll('[role="combobox"]') ?? [])].map((t) => t.textContent);
}

function claudeSettings(overrides: Partial<ClaudeSettings> = {}): ClaudeSettings {
    return {
        defaultModel: "default",
        defaultEffort: "default",
        permissionMode: "default",
        accounts: [],
        defaultAccount: "default",
        ...overrides,
    };
}

afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
});

test("session Default names the Settings value it launches with", () => {
    render({
        settings: claudeSettings({
            defaultModel: "opus",
            defaultEffort: "xhigh",
            permissionMode: "bypassPermissions",
        }),
    });
    expect(triggers()).toEqual([
        "Default (Opus, from Settings)",
        "Default (Extra High, from Settings)",
        "Default (Bypass Permissions, from Settings)",
    ]);
});

test("session Default says the CLI decides when Settings leave it unset", () => {
    render({ settings: claudeSettings() });
    expect(triggers()).toEqual([
        "Default (Claude CLI default)",
        "Default (Claude CLI default)",
        "Default (Claude CLI default)",
    ]);
});

test("headless Default is the CLI's, whatever Settings say", () => {
    render({ headless: true, settings: claudeSettings({ defaultEffort: "max" }) });
    expect(triggers()).toEqual(["Default (Claude CLI default)", "Default (Claude CLI default)"]);
});

test("the Settings page keeps its plain Default labels", () => {
    render({ mode: "defaults", settings: claudeSettings({ defaultEffort: "max" }) });
    expect(triggers()).toEqual(["Default", "Default", "Inherit Claude Default"]);
});
