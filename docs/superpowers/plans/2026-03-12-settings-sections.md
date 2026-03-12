# Settings Window Sections Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the settings modal into a sidebar-navigated layout with Fonts and Defaults sections, adding default agent and default runtime settings with backend runtime detection.

**Architecture:** Shared types gain `AgentType`, `RuntimeInfo`, and `RuntimeListResponse`. Backend gets a runtime detector service (mirrors shell-detector) and a new `RUNTIMES_LIST` handler. The `SettingsModal` UI is restructured from flat sections to a sidebar + content panel layout. Settings store defaults are updated with new fields.

**Tech Stack:** TypeScript, React, Zustand, Bun (backend), WebSocket messaging

---

## Chunk 1: Shared Types & Constants

### Task 1: Add AgentType to agent types

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [ ] **Step 1: Add `AgentType` and export it**

In `packages/shared/src/types/agent.ts`, add the type and include it in the export:

```ts
type AgentType = "claude" | "codex";
```

Update `ClaudeLaunchOptions` and `CodexLaunchOptions` to use `AgentType` for their `type` field:

```ts
interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
}
```

Add `AgentType` to the `export type { ... }` line.

- [ ] **Step 2: Verify no type errors**

Run: `cd packages/shared && bun tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/agent.ts
git commit -m "feat: add AgentType to shared types"
```

### Task 2: Add RuntimeInfo types and RUNTIMES_LIST constant

**Files:**
- Modify: `packages/shared/src/types/ws.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/settings.ts`

- [ ] **Step 1: Add RuntimeInfo and RuntimeListResponse to ws.ts**

In `packages/shared/src/types/ws.ts`, after the `ShellListResponse` interface (~line 166), add:

```ts
// Runtime detection
export interface RuntimeInfo {
    name: string;
    path: string;
    version: string;
}

export interface RuntimeListResponse {
    runtimes: RuntimeInfo[];
}
```

- [ ] **Step 2: Add RUNTIMES_LIST to MSG constant**

In `packages/shared/src/constants.ts`, add to the Sessions section (after `SCRIPTS_LIST` on line 28):

```ts
RUNTIMES_LIST: "runtimes:list",
```

- [ ] **Step 3: Add new fields to GeneralSettings**

In `packages/shared/src/types/settings.ts`, import `AgentType` and add to `GeneralSettings`:

```ts
import type { AgentType } from "./agent";

export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    externalEditor: string;
    defaultAgent: AgentType;
    defaultRuntime: string;
}
```

No changes to `SettingsUpdatePayload` needed — it already uses `Partial<GeneralSettings>`.

- [ ] **Step 4: Verify no type errors across shared package**

Run: `cd packages/shared && bun tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/ws.ts packages/shared/src/constants.ts packages/shared/src/types/settings.ts
git commit -m "feat: add runtime types, RUNTIMES_LIST message, and default agent/runtime settings"
```

## Chunk 2: Backend — Runtime Detection & Settings Defaults

### Task 3: Create runtime detector service

**Files:**
- Create: `packages/backend/src/services/runtime-detector.ts`
- Create: `packages/backend/tests/services/runtime-detector.test.ts`

- [ ] **Step 1: Write the tests**

Create `packages/backend/tests/services/runtime-detector.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { detectRuntimes } from "../../src/services/runtime-detector";

describe("detectRuntimes", () => {
    it("returns at least one runtime on a dev machine", async () => {
        const runtimes = await detectRuntimes();
        expect(runtimes.length).toBeGreaterThan(0);
    });

    it("detects bun when running under bun", async () => {
        const runtimes = await detectRuntimes();
        const bun = runtimes.find((r) => r.name === "bun");
        expect(bun).toBeDefined();
        expect(bun!.path).toBeTruthy();
        expect(bun!.version).not.toBe("unknown");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runtime detector**

Create `packages/backend/src/services/runtime-detector.ts`:

```ts
import type { RuntimeInfo } from "@taskflow/shared";

const KNOWN_RUNTIMES = ["bun", "node"] as const;

async function getRuntimeVersion(path: string): Promise<string> {
    try {
        const proc = Bun.spawn([path, "--version"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const output = await new Response(proc.stdout).text();
        await proc.exited;
        const version = output.trim().replace(/^v/, "");
        return version || "unknown";
    } catch {
        return "unknown";
    }
}

export async function detectRuntimes(): Promise<RuntimeInfo[]> {
    const runtimes: RuntimeInfo[] = [];

    for (const name of KNOWN_RUNTIMES) {
        const path = Bun.which(name);
        if (!path) continue;
        const version = await getRuntimeVersion(path);
        runtimes.push({ name, path, version });
    }

    return runtimes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/runtime-detector.ts packages/backend/tests/services/runtime-detector.test.ts
git commit -m "feat: add runtime detector service"
```

### Task 4: Update settings store defaults

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts`
- Modify: `packages/backend/tests/services/settings-store.test.ts`

- [ ] **Step 1: Update the existing defaults test**

In `packages/backend/tests/services/settings-store.test.ts`, update the `"returns fresh defaults"` test's expected `general` object to include the new fields:

```ts
general: {
    fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
    fontSize: 13,
    externalEditor: "system",
    defaultAgent: "claude",
    defaultRuntime: "bun",
},
```

Also update the second assertion in the same test (the mutation check). Then update **both** assertions in the `"merges persisted and partial editor updates with defaults"` test — the `expect(await store.get())` assertion (~line 83) and the `expect(await store.update(...))` assertion (~line 101) — adding to each `general` object:

```ts
defaultAgent: "claude",
defaultRuntime: "bun",
```

- [ ] **Step 2: Add a test for updating the new fields**

Add to the test file:

```ts
it("persists defaultAgent and defaultRuntime settings", async () => {
    const result = await store.update({
        general: { defaultAgent: "codex", defaultRuntime: "node" },
    });

    expect(result.general.defaultAgent).toBe("codex");
    expect(result.general.defaultRuntime).toBe("node");
    expect((await store.get()).general.defaultAgent).toBe("codex");
    expect((await store.get()).general.defaultRuntime).toBe("node");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: FAIL — missing fields in defaults

- [ ] **Step 4: Update DEFAULTS in settings-store.ts**

In `packages/backend/src/services/settings-store.ts`, update the `DEFAULTS.general` object:

```ts
general: {
    fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
    fontSize: 13,
    externalEditor: "system",
    defaultAgent: "claude",
    defaultRuntime: "bun",
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/settings-store.ts packages/backend/tests/services/settings-store.test.ts
git commit -m "feat: add defaultAgent and defaultRuntime to settings defaults"
```

### Task 5: Register RUNTIMES_LIST handler

**Files:**
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Add runtime detection and handler registration**

In `packages/backend/src/index.ts`, import `detectRuntimes`:

```ts
import { detectRuntimes } from "./services/runtime-detector";
```

Near the existing `detectShells()` call and `SHELLS_LIST` registration (~line 105-111), add:

```ts
const runtimes = await detectRuntimes();
router.register(MSG.RUNTIMES_LIST, async () => ({ runtimes }));
console.log(`Detected runtimes: ${runtimes.map((r) => r.name + " " + r.version).join(", ") || "none"}`);
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd packages/backend && bun tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "feat: register RUNTIMES_LIST WebSocket handler"
```

## Chunk 3: UI — Sectioned Settings Modal

### Task 6: Refactor SettingsModal to sidebar layout

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Restructure the modal layout**

Rewrite `SettingsModal.tsx` with the sidebar navigation pattern. Key changes:

1. Add section state: `const [section, setSection] = useState<"fonts" | "defaults">("fonts");`

2. Add runtime fetching alongside shell fetching (in the existing `useEffect` that fires when `open` changes):
```ts
import { type RuntimeInfo, type RuntimeListResponse } from "@taskflow/shared";

const [runtimes, setRuntimes] = useState<RuntimeInfo[]>([]);

// Inside the useEffect:
sendRequest<RuntimeListResponse>(MSG.RUNTIMES_LIST, {}).then(
    (response) => setRuntimes(response.runtimes),
    () => setRuntimes([]),
);
```

3. Add handlers for the new settings:
```ts
const handleDefaultAgent = useCallback(
    (value: string) => {
        if (value === "claude" || value === "codex") {
            void updateSettings({ general: { defaultAgent: value } });
        }
    },
    [updateSettings],
);

const handleDefaultRuntime = useCallback(
    (defaultRuntime: string) => {
        void updateSettings({ general: { defaultRuntime } });
    },
    [updateSettings],
);
```

4. Replace the flat `<div className="space-y-6">` with a flex layout:
```tsx
<div className="flex min-h-[360px]">
    {/* Sidebar */}
    <nav className="w-40 shrink-0 border-r border-border pr-2 space-y-1">
        <button
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm ${
                section === "fonts"
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            onClick={() => setSection("fonts")}
        >
            Fonts
        </button>
        <button
            className={`w-full text-left px-3 py-1.5 rounded-md text-sm ${
                section === "defaults"
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
            onClick={() => setSection("defaults")}
        >
            Defaults
        </button>
    </nav>

    {/* Content */}
    <div className="flex-1 pl-6 space-y-6">
        {section === "fonts" && (
            <>
                {/* Application Font section */}
                {/* Terminal Font section */}
                {/* Editor Font section */}
            </>
        )}
        {section === "defaults" && (
            <>
                {/* External Editor */}
                {/* Default Agent */}
                {/* Default Shell */}
                {/* Default Runtime */}
            </>
        )}
    </div>
</div>
```

5. Move all existing font sections into the `fonts` condition block.

6. Move External Editor into `defaults` block. Move Default Shell from under "Terminal Font" into `defaults` block. Add new Default Agent and Default Runtime selects.

7. Default Agent select:
```tsx
<section className="space-y-3">
    <h3 className="text-sm font-medium">Default Agent</h3>
    <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
            Pre-selected agent for new tasks, title generation, and commit messages
        </Label>
        <Select
            value={settings.general.defaultAgent}
            onValueChange={handleDefaultAgent}
        >
            <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="claude">Claude</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
            </SelectContent>
        </Select>
    </div>
</section>
```

8. Default Runtime select (with missing-runtime handling following the shell pattern):
```tsx
<section className="space-y-3">
    <h3 className="text-sm font-medium">Default Runtime</h3>
    <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">
            Runtime for executing scripts and commands
        </Label>
        <Select
            value={
                runtimes.some((r) => r.name === settings.general.defaultRuntime)
                    ? settings.general.defaultRuntime
                    : "__missing__"
            }
            onValueChange={handleDefaultRuntime}
        >
            <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {runtimes.length === 0 && (
                    <SelectItem value="__none__" disabled>
                        No runtimes detected
                    </SelectItem>
                )}
                {runtimes.map((rt) => (
                    <SelectItem key={rt.name} value={rt.name}>
                        {rt.name} ({rt.version})
                    </SelectItem>
                ))}
                {runtimes.length > 0 &&
                    !runtimes.some((r) => r.name === settings.general.defaultRuntime) && (
                    <SelectItem value="__missing__" disabled>
                        {settings.general.defaultRuntime} (not found)
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    </div>
</section>
```

9. Update dialog width from `42rem` to `48rem` in all three places:
   - `w-[min(42rem,...)]` → `w-[min(48rem,...)]`
   - `max-w-[calc(100vw-2rem)]` stays the same
   - `sm:max-w-[42rem]` → `sm:max-w-[48rem]`

- [ ] **Step 2: Update imports**

Add to existing imports from `@taskflow/shared`:
```ts
import type { RuntimeInfo, RuntimeListResponse } from "@taskflow/shared";
```

`MSG` is already imported (covers `MSG.RUNTIMES_LIST`). No `AgentType` import needed — the handler narrows `string` via equality checks.

- [ ] **Step 3: Verify UI compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual verification**

Start the dev environment and verify:
1. Settings modal opens with sidebar showing "Fonts" and "Defaults"
2. Fonts section shows Application, Terminal, and Editor font settings
3. Clicking "Defaults" switches to show External Editor, Default Agent, Default Shell, Default Runtime
4. All dropdowns work and changes persist
5. Dialog width accommodates the sidebar comfortably

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: refactor settings modal to sidebar-navigated sections layout"
```

### Task 7: Run all tests

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

Run: `cd packages/backend && bun test`
Expected: all tests pass

- [ ] **Step 2: Run full UI type check**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run full shared type check**

Run: `cd packages/shared && bun tsc --noEmit`
Expected: no errors
