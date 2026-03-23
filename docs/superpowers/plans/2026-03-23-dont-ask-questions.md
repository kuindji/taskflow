# "Don't Ask Questions" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Don't ask questions" toggle that makes agents fully autonomous by forcing full access and injecting an autonomous system prompt.

**Architecture:** New `dontAskQuestions` boolean flows through types → settings → launch spec → system prompt injection. The autonomous prompt is appended in `session-lifecycle.ts` (before agent-specific delivery) so all agents receive it regardless of their prompt delivery mechanism. The `fullAccess` CLI flags are forced in `buildAgentLaunchSpec`.

**Tech Stack:** TypeScript, React, Bun test runner

---

### Task 1: Add `dontAskQuestions` to shared types

**Files:**
- Modify: `packages/shared/src/types/agent.ts:13-47`
- Modify: `packages/shared/src/types/settings.ts:11-33`

- [ ] **Step 1: Add `dontAskQuestions` to each launch options interface in `agent.ts`**

Add `dontAskQuestions?: boolean;` to each of the 5 interfaces, after the existing `fullAccess` field:

```typescript
interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
}

interface OpenCodeLaunchOptions {
    type: Extract<AgentType, "opencode">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: string;
}

interface GeminiLaunchOptions {
    type: Extract<AgentType, "gemini">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: "auto" | "pro" | "flash" | "flash-lite";
}

interface CursorLaunchOptions {
    type: Extract<AgentType, "cursor">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: string;
}
```

- [ ] **Step 2: Add `dontAskQuestions` to each settings interface in `settings.ts`**

Add `dontAskQuestions: boolean;` (non-optional, since settings have defaults) to each of the 5 settings interfaces:

```typescript
export interface ClaudeSettings {
    defaultModel: "default" | "opus" | "sonnet" | "haiku";
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface CodexSettings {
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface OpenCodeSettings {
    defaultModel: string;
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface GeminiSettings {
    defaultModel: "default" | "auto" | "pro" | "flash" | "flash-lite";
    fullAccess: boolean;
    dontAskQuestions: boolean;
}

export interface CursorSettings {
    defaultModel: string;
    fullAccess: boolean;
    dontAskQuestions: boolean;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/shared' build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/settings.ts
git commit -m "feat: add dontAskQuestions to agent launch options and settings types"
```

---

### Task 2: Add settings defaults

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts:49-67`

- [ ] **Step 1: Add `dontAskQuestions: false` to each agent's defaults**

In the `DEFAULTS` constant, add `dontAskQuestions: false` to each agent section:

```typescript
claude: {
    defaultModel: "default",
    fullAccess: false,
    dontAskQuestions: false,
},
codex: {
    fullAccess: false,
    dontAskQuestions: false,
},
opencode: {
    defaultModel: "",
    fullAccess: false,
    dontAskQuestions: false,
},
gemini: {
    defaultModel: "default",
    fullAccess: false,
    dontAskQuestions: false,
},
cursor: {
    defaultModel: "default",
    fullAccess: false,
    dontAskQuestions: false,
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/settings-store.ts
git commit -m "feat: add dontAskQuestions defaults to settings store"
```

---

### Task 3: Add autonomous prompt constant and force fullAccess in launch spec

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts:11-13,68-162`

- [ ] **Step 1: Write the failing test — `dontAskQuestions` forces fullAccess flags for Claude**

In `packages/backend/tests/services/internal-agent-skill.test.ts`, add:

```typescript
it("dontAskQuestions forces --dangerously-skip-permissions for Claude", () => {
    const spec = buildAgentLaunchSpec("claude", "Do it", "/tmp/ignored/SKILL.md", {
        type: "claude",
        dontAskQuestions: true,
    });
    expect(spec.args).toContain("--dangerously-skip-permissions");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kuindji/Projects/taskflow && bun test packages/backend/tests/services/internal-agent-skill.test.ts`
Expected: FAIL — `dontAskQuestions` is not recognized yet.

- [ ] **Step 3: Write more failing tests for other agents**

```typescript
it("dontAskQuestions forces --full-auto for Codex", () => {
    const spec = buildAgentLaunchSpec("codex", "Do it", "/tmp/ignored/SKILL.md", {
        type: "codex",
        dontAskQuestions: true,
    });
    expect(spec.args).toContain("--full-auto");
});

it("dontAskQuestions forces --yolo for Gemini", () => {
    const spec = buildAgentLaunchSpec("gemini", "Do it", "/tmp/ignored/SKILL.md", {
        type: "gemini",
        dontAskQuestions: true,
    });
    expect(spec.args).toContain("--yolo");
});

it("dontAskQuestions forces --yolo for Cursor", () => {
    const spec = buildAgentLaunchSpec("cursor", "Do it", "/tmp/ignored/SKILL.md", {
        type: "cursor",
        dontAskQuestions: true,
    });
    expect(spec.args).toContain("--yolo");
});

it("dontAskQuestions forces permission allow for OpenCode", () => {
    const spec = buildAgentLaunchSpec("opencode", "Do it", "/tmp/ignored/SKILL.md", {
        type: "opencode",
        dontAskQuestions: true,
    });
    const config = JSON.parse(spec.env!.OPENCODE_CONFIG_CONTENT);
    expect(config.permission).toEqual({ edit: "allow", bash: "allow", write: "allow" });
});

it("PROMPT_AUTONOMOUS is exported and contains expected content", () => {
    expect(PROMPT_AUTONOMOUS).toContain("Do not ask clarifying questions");
    expect(PROMPT_AUTONOMOUS).toContain("proceed autonomously");
});
```

Update the import at the top of the test file to also import `PROMPT_AUTONOMOUS`:

```typescript
import {
    buildSystemPrompt,
    ensureCliScript,
    buildAgentLaunchSpec,
    PROMPT_AUTONOMOUS,
} from "../../src/services/internal-agent-skill";
```

- [ ] **Step 4: Define `PROMPT_AUTONOMOUS` and export it**

In `packages/backend/src/services/internal-agent-skill.ts`, add after the existing `PROMPT_FLOW` constant:

```typescript
const PROMPT_AUTONOMOUS =
    "Do not ask clarifying questions. Do not ask for confirmation. Make reasonable assumptions and proceed autonomously. If something is ambiguous, choose the most likely interpretation and act on it.";
```

Export it at the bottom or inline — it needs to be importable by `session-lifecycle.ts`.

- [ ] **Step 5: Update `buildAgentLaunchSpec` to treat `dontAskQuestions` as `fullAccess`**

In each agent branch, change the `fullAccess` check to also trigger on `dontAskQuestions`. For example, for Claude:

```typescript
if (agentOptions?.type === "claude") {
    if (agentOptions.fullAccess || agentOptions.dontAskQuestions)
        optionArgs.push("--dangerously-skip-permissions");
    if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
}
```

Apply the same pattern to all 5 agent branches:
- Claude: `fullAccess || dontAskQuestions` → `--dangerously-skip-permissions`
- Codex: `fullAccess || dontAskQuestions` → `--full-auto`
- Gemini: `fullAccess || dontAskQuestions` → `--yolo`
- Cursor: `fullAccess || dontAskQuestions` → `--yolo`
- OpenCode: `fullAccess || dontAskQuestions` → permission JSON

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/kuindji/Projects/taskflow && bun test packages/backend/tests/services/internal-agent-skill.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts packages/backend/tests/services/internal-agent-skill.test.ts
git commit -m "feat: add PROMPT_AUTONOMOUS and force fullAccess flags when dontAskQuestions is set"
```

---

### Task 4: Inject autonomous prompt in session lifecycle

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts:203-222`

- [ ] **Step 1: Import `PROMPT_AUTONOMOUS` from `internal-agent-skill`**

At the top of `session-lifecycle.ts`, add `PROMPT_AUTONOMOUS` to the existing import from `./internal-agent-skill`.

- [ ] **Step 2: Append autonomous prompt to `systemPrompt` when `dontAskQuestions` is set**

In the agent session branch (around line 203, before the calls to `ensureCursorRulesFile`, `ensureGeminiSystemFile`, and `buildAgentLaunchSpec`), add:

```typescript
let effectiveSystemPrompt = systemPrompt;
if (agentOptions?.dontAskQuestions) {
    effectiveSystemPrompt = effectiveSystemPrompt
        ? `${effectiveSystemPrompt}\n\n${PROMPT_AUTONOMOUS}`
        : PROMPT_AUTONOMOUS;
}
```

Then use `effectiveSystemPrompt` in place of `systemPrompt` for the three downstream calls:
- `ensureCursorRulesFile(cwd, effectiveSystemPrompt)`
- `ensureGeminiSystemFile(config.agentSkillsDir, !task, effectiveSystemPrompt)`
- `buildAgentLaunchSpec(type, prompt, skillPath, agentOptions, effectiveSystemPrompt, !task, !!flow)`

- [ ] **Step 3: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/backend' build`
Expected: Build succeeds.

- [ ] **Step 4: Run existing tests to confirm nothing broke**

Run: `cd /Users/kuindji/Projects/taskflow && bun test packages/backend/tests/`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts
git commit -m "feat: inject autonomous prompt in session lifecycle for all agent types"
```

---

### Task 5: Add "Don't ask questions" toggle to AgentOptionsPanel

**Files:**
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx:25-172`

- [ ] **Step 1: Add state and default resolution for `dontAskQuestions`**

Follow the existing pattern for `defaultFullAccess`. Add a `defaultDontAskQuestions` that reads from the matching value or settings:

```typescript
const defaultDontAskQuestions =
    matchingValue?.dontAskQuestions ??
    (agentType === "claude"
        ? (claudeSettings?.dontAskQuestions ?? false)
        : agentType === "opencode"
          ? (opencodeSettings?.dontAskQuestions ?? false)
          : agentType === "gemini"
            ? (geminiSettings?.dontAskQuestions ?? false)
            : agentType === "cursor"
              ? (cursorSettings?.dontAskQuestions ?? false)
              : (codexSettings?.dontAskQuestions ?? false));
```

Add state:
```typescript
const [dontAskQuestions, setDontAskQuestions] = useState(defaultDontAskQuestions);
```

Update the existing `useEffect` that syncs defaults to also sync `dontAskQuestions`:
```typescript
setDontAskQuestions(defaultDontAskQuestions);
```

- [ ] **Step 2: Include `dontAskQuestions` in `emitChange` and `handleRun`**

In both `emitChange` and `handleRun`, add `dontAskQuestions: dontAskQuestions || undefined` to each agent's options object (alongside `fullAccess`). Also add `dontAskQuestions` to the `useCallback` dependency arrays.

- [ ] **Step 3: Add the UI switch**

Add a second Switch below the existing "Full access" switch. When `dontAskQuestions` is on, show the fullAccess switch as checked and disabled (without modifying the underlying `fullAccess` state — the launch spec already forces fullAccess when `dontAskQuestions` is set):

```tsx
<div className="flex items-center gap-2">
    <Switch
        id="agent-full-access"
        checked={fullAccess || dontAskQuestions}
        onCheckedChange={setFullAccess}
        disabled={dontAskQuestions}
    />
    <Label htmlFor="agent-full-access" className="cursor-pointer text-xs">
        Full access
    </Label>
</div>
<div className="flex items-center gap-2">
    <Switch
        id="agent-dont-ask"
        checked={dontAskQuestions}
        onCheckedChange={setDontAskQuestions}
    />
    <Label htmlFor="agent-dont-ask" className="cursor-pointer text-xs">
        Don&apos;t ask questions
    </Label>
</div>
```

This way, toggling `dontAskQuestions` off restores the original `fullAccess` state automatically.

- [ ] **Step 4: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/ui' build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/AgentOptionsPanel.tsx
git commit -m "feat: add Don't ask questions toggle to AgentOptionsPanel"
```

---

### Task 6: Add "Don't ask questions" toggle to SettingsModal

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx:160-216,634-773`

- [ ] **Step 1: Add callbacks for each agent**

Following the existing pattern for `handleClaudeFullAccess`, add callbacks:

```typescript
const handleClaudeDontAsk = useCallback(
    (dontAskQuestions: boolean) => {
        void updateSettings({
            claude: {
                dontAskQuestions,
                ...(dontAskQuestions ? { fullAccess: true } : {}),
            },
        });
    },
    [updateSettings],
);

const handleCodexDontAsk = useCallback(
    (dontAskQuestions: boolean) => {
        void updateSettings({
            codex: {
                dontAskQuestions,
                ...(dontAskQuestions ? { fullAccess: true } : {}),
            },
        });
    },
    [updateSettings],
);

const handleOpencodeDontAsk = useCallback(
    (dontAskQuestions: boolean) => {
        void updateSettings({
            opencode: {
                dontAskQuestions,
                ...(dontAskQuestions ? { fullAccess: true } : {}),
            },
        });
    },
    [updateSettings],
);

const handleGeminiDontAsk = useCallback(
    (dontAskQuestions: boolean) => {
        void updateSettings({
            gemini: {
                dontAskQuestions,
                ...(dontAskQuestions ? { fullAccess: true } : {}),
            },
        });
    },
    [updateSettings],
);

const handleCursorDontAsk = useCallback(
    (dontAskQuestions: boolean) => {
        void updateSettings({
            cursor: {
                dontAskQuestions,
                ...(dontAskQuestions ? { fullAccess: true } : {}),
            },
        });
    },
    [updateSettings],
);
```

- [ ] **Step 2: Add the toggle UI for each agent section**

After each agent's "Full Access" `SettingRow`, add a "Don't Ask Questions" row. Also disable the Full Access switch when dontAskQuestions is enabled. Example for Claude:

```tsx
<SettingRow
    label="Full Access"
    hint="Skip permission prompts by default">
    <div className="flex items-center gap-2.5">
        <Switch
            id="claude-full-access"
            checked={settings.claude.fullAccess}
            onCheckedChange={handleClaudeFullAccess}
            disabled={settings.claude.dontAskQuestions}
        />
        <Label
            htmlFor="claude-full-access"
            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
            {settings.claude.fullAccess ? "Enabled" : "Disabled"}
        </Label>
    </div>
</SettingRow>
<SettingRow
    label="Don't Ask Questions"
    hint="Make agent fully autonomous (implies full access)">
    <div className="flex items-center gap-2.5">
        <Switch
            id="claude-dont-ask"
            checked={settings.claude.dontAskQuestions}
            onCheckedChange={handleClaudeDontAsk}
        />
        <Label
            htmlFor="claude-dont-ask"
            className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
            {settings.claude.dontAskQuestions ? "Enabled" : "Disabled"}
        </Label>
    </div>
</SettingRow>
```

Repeat the same pattern for Codex, OpenCode, Gemini, and Cursor sections — each getting a "Don't Ask Questions" row after the "Full Access" row, and each Full Access switch getting `disabled={settings.<agent>.dontAskQuestions}`.

- [ ] **Step 3: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '@taskflow/ui' build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: add Don't ask questions toggle to SettingsModal for all agents"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/kuindji/Projects/taskflow && bun test`
Expected: All tests PASS.

- [ ] **Step 2: Run full build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`
Expected: Build succeeds across all packages.

- [ ] **Step 3: Verify type checking**

Run: `cd /Users/kuindji/Projects/taskflow && bun run typecheck`
Expected: No type errors.
