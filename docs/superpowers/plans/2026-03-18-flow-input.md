# Flow Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow flow definitions to declare typed input fields that users fill in before execution, stored on the FlowRun and accessible to agents via `taskflow-cli flow input`.

**Architecture:** New `FlowInputDefinition` type on `FlowDefinition`, `inputValues` on `FlowRun`. UI shows a modal for input collection before starting flows with inputs. Agents read values via new HTTP endpoints and CLI command.

**Tech Stack:** TypeScript, React, Zustand, Electron IPC, shell script (CLI)

---

### Task 1: Add shared types

**Files:**
- Modify: `packages/shared/src/types/flow.ts`

- [ ] **Step 1: Add FlowInputDefinition interface and extend FlowDefinition, FlowRun, FlowStartPayload**

Add after `ActionInline` interface (line 22):

```typescript
interface FlowInputDefinition {
    id: string;
    label: string;
    type: "text" | "filepath";
}
```

Add `inputs?: FlowInputDefinition[]` to `FlowDefinition` (after `actions`):

```typescript
interface FlowDefinition {
    id: string;
    projectId?: string;
    name: string;
    description: string;
    actions: FlowActionEntry[];
    inputs?: FlowInputDefinition[];
    createdAt: string;
    updatedAt: string;
}
```

Add `inputValues?: Record<string, string>` to `FlowRun` (after `artifacts`):

```typescript
type FlowRun = FlowOwner & {
    flowId: string;
    status: FlowRunStatus;
    currentActionIndex: number;
    actions: FlowActionState[];
    artifacts: FlowArtifact[];
    inputValues?: Record<string, string>;
    startedAt: string;
    completedAt?: string;
};
```

Add `inputValues?: Record<string, string>` to `FlowStartPayload` (after `flowId`):

```typescript
interface FlowStartPayload {
    taskId?: string;
    projectId?: string;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

Add `FlowInputDefinition` to the `export type { ... }` block.

- [ ] **Step 2: Verify build**

Run: `cd packages/shared && bun run build`
Expected: Clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/flow.ts
git commit -m "feat(flow): add FlowInputDefinition type and extend FlowRun/FlowStartPayload"
```

---

### Task 2: Backend — FlowStore validation

**Files:**
- Modify: `packages/backend/src/services/flow-store.ts:12-46`

- [ ] **Step 1: Add input validation to assertValidFlowDefinition**

Add after the actions validation loop (after line 45, before the closing `}`):

```typescript
    if (flow.inputs) {
        const inputIds = new Set<string>();
        for (const input of flow.inputs) {
            if (typeof input.id !== "string" || input.id.trim().length === 0) {
                throw new Error(`Flow "${flow.id}" has an input with an empty id`);
            }
            if (inputIds.has(input.id)) {
                throw new Error(`Flow "${flow.id}" has duplicate input id: "${input.id}"`);
            }
            inputIds.add(input.id);
            if (typeof input.label !== "string" || input.label.trim().length === 0) {
                throw new Error(`Flow input "${input.id}" must have a non-empty label`);
            }
            if (input.type !== "text" && input.type !== "filepath") {
                throw new Error(`Flow input "${input.id}" has invalid type: "${input.type}"`);
            }
        }
    }
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/flow-store.ts
git commit -m "feat(flow): validate input definitions in flow store"
```

---

### Task 3: Backend — FlowRunner accepts inputValues

**Files:**
- Modify: `packages/backend/src/services/flow-runner.ts:69-115` (startFlow)
- Modify: `packages/backend/src/services/flow-runner.ts:499-518` (buildActionPrompt)

- [ ] **Step 1: Add inputValues parameter to startFlow**

Change the `startFlow` method signature (line 69) from:

```typescript
    async startFlow(owner: FlowOwner, flow: FlowDefinition): Promise<FlowRun> {
```

to:

```typescript
    async startFlow(owner: FlowOwner, flow: FlowDefinition, inputValues?: Record<string, string>): Promise<FlowRun> {
```

Add input validation after the `flow.actions.length === 0` check (after line 72):

```typescript
        if (flow.inputs && flow.inputs.length > 0) {
            for (const input of flow.inputs) {
                const value = inputValues?.[input.id];
                if (typeof value !== "string" || value.trim().length === 0) {
                    throw new Error(`Missing required flow input: "${input.id}"`);
                }
            }
        }
```

Add `inputValues` to the `FlowRun` object construction (inside the run object, after `artifacts: []`):

```typescript
                inputValues: flow.inputs && flow.inputs.length > 0 ? inputValues : undefined,
```

- [ ] **Step 2: Update buildActionPrompt to include flow input instructions**

In `buildActionPrompt` (line 499), update the `systemPrompt` array to include flow input CLI commands. Add after the artifact lines:

```typescript
            `Use \`taskflow-cli flow input\` to list all flow input values.`,
            `Use \`taskflow-cli flow input <id>\` to get a specific input value.`,
```

The full systemPrompt array should become:

```typescript
        const systemPrompt = [
            `## ${descriptionHeader}\n\n${ownerDescription}`,
            `## Taskflow CLI`,
            `Use \`taskflow-cli task\` to read task info and logs.`,
            `Use \`taskflow-cli artifact list\` to see available artifacts from prior actions.`,
            `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
            `Use \`taskflow-cli flow input\` to list all flow input values.`,
            `Use \`taskflow-cli flow input <id>\` to get a specific input value.`,
            `When you have completed this action, run \`taskflow-cli action complete\`.`,
        ].join("\n\n");
```

- [ ] **Step 3: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/flow-runner.ts
git commit -m "feat(flow): accept and validate inputValues in FlowRunner.startFlow"
```

---

### Task 4: Backend — WebSocket handler passes inputValues

**Files:**
- Modify: `packages/backend/src/handlers/flow.ts:85-100`

- [ ] **Step 1: Update FLOW_START handler to validate and pass inputValues**

Replace the `FLOW_START` handler block (lines 85-100) with:

```typescript
    router.register(
        MSG.FLOW_START,
        typed<FlowStartPayload>(async (payload) => {
            const flows = await flowStore.getFlows();
            const flow = flows.find((f) => f.id === payload.flowId);
            if (!flow) throw new Error(`Flow not found: ${payload.flowId}`);

            // Validate inputValues shape if present
            let inputValues: Record<string, string> | undefined;
            if (payload.inputValues !== undefined) {
                if (
                    typeof payload.inputValues !== "object" ||
                    payload.inputValues === null ||
                    Array.isArray(payload.inputValues)
                ) {
                    throw new Error("inputValues must be a plain object with string values");
                }
                for (const [key, value] of Object.entries(payload.inputValues)) {
                    if (typeof value !== "string") {
                        throw new Error(`inputValues["${key}"] must be a string`);
                    }
                }
                inputValues = payload.inputValues;
            }

            if (payload.taskId) {
                return await flowRunner.startFlow({ taskId: payload.taskId }, flow, inputValues);
            }
            if (!payload.projectId) {
                throw new Error("Flow start requires either taskId or projectId");
            }
            const owner: FlowOwner = { projectId: payload.projectId };
            return await flowRunner.startFlow(owner, flow, inputValues);
        }),
    );
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/flow.ts
git commit -m "feat(flow): validate and forward inputValues in FLOW_START handler"
```

---

### Task 5: Backend — HTTP API endpoints for flow input

**Files:**
- Modify: `packages/backend/src/api/routes.ts` (add before closing `}` of `registerApiRoutes`, ~line 498)

- [ ] **Step 1: Add GET /api/flow/input endpoints**

Add before the closing `}` of `registerApiRoutes` (line 498), after the last artifact endpoint:

```typescript
    // --- Flow input values ---

    apiRouter.register("GET", "/api/flow/input/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ inputValues: run.inputValues ?? {} });
    });

    apiRouter.register(
        "GET",
        "/api/flow/input/:ownerId/:flowId/:inputId",
        async (_req, params) => {
            const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
            if (!run) return errorResponse("Flow run not found", 404);
            const value = run.inputValues?.[params.inputId];
            if (value === undefined) {
                return errorResponse(`Input "${params.inputId}" not found`, 404);
            }
            // Return plain text for easy CLI consumption (no JSON parsing needed)
            return new Response(value, {
                status: 200,
                headers: { "Content-Type": "text/plain" },
            });
        },
    );
```

- [ ] **Step 2: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/api/routes.ts
git commit -m "feat(flow): add HTTP endpoints for reading flow input values"
```

---

### Task 6: CLI — Add flow input command

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts`

- [ ] **Step 1: Add flow command to CLI_SCRIPT**

In `CLI_SCRIPT`, add a new `flow)` case before the `*)` default case (before line 440). Place it after the `artifact)` case closing `;;`:

```shell
  flow)
    if [ -z "$TASKFLOW_FLOW_ID" ]; then
      echo "Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)" >&2
      exit 1
    fi
    if [ -n "$TASKFLOW_TASK_ID" ]; then
      flow_owner_id="$TASKFLOW_TASK_ID"
    else
      flow_owner_id="$TASKFLOW_PROJECT_ID"
    fi
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      input)
        input_id="${1:-}"
        if [ -z "$input_id" ]; then
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID"
        else
          # Endpoint returns plain text — output directly
          curl -sf "$TASKFLOW_API_URL/api/flow/input/$flow_owner_id/$TASKFLOW_FLOW_ID/$input_id"
        fi
        ;;
      *)
        echo "Usage: taskflow-cli flow <input>" >&2
        exit 1
        ;;
    esac
    ;;
```

- [ ] **Step 2: Update PROMPT_FLOW to mention flow input commands**

Change `PROMPT_FLOW` (line 36) to add the new commands:

```typescript
const PROMPT_FLOW = `
When running as a flow action (TASKFLOW_FLOW_ID is set):
- Signal action completion: \`taskflow-cli action complete\`
- Save a file artifact: \`taskflow-cli artifact save <type> --path <path>\`
- Save a text artifact: \`taskflow-cli artifact save <type> --text <text>\`
- List all artifacts: \`taskflow-cli artifact list\`
- Get artifact by type: \`taskflow-cli artifact get <type>\`
- Get all flow inputs: \`taskflow-cli flow input\`
- Get a specific flow input: \`taskflow-cli flow input <id>\``;
```

- [ ] **Step 3: Update INTERNAL_AGENT_SKILL_MARKDOWN**

Add a new section in the skill markdown (after the artifact section, before the closing backtick):

```markdown
## Flow inputs (available when TASKFLOW_FLOW_ID is set)

Read input values provided by the user when the flow was started:

\`\`\`
taskflow-cli flow input
taskflow-cli flow input <id>
\`\`\`
```

- [ ] **Step 4: Update the help text in the default case**

Add the flow command to the usage list in the `*)` case:

```shell
    echo "  flow input [<id>]                             Get flow input values" >&2
```

- [ ] **Step 5: Verify build**

Run: `cd packages/backend && bun run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts
git commit -m "feat(flow): add taskflow-cli flow input command and update prompts"
```

---

### Task 7: Electron — Add file picker IPC

**Files:**
- Modify: `electron/src/main.ts` (add IPC handler)
- Modify: `electron/src/preload.ts` (expose to renderer)
- Modify: `packages/ui/src/env.d.ts` (add to TaskflowBridge interface)

- [ ] **Step 1: Add IPC handler in main.ts**

Add after the existing `select-theme-file` handler (around line 736):

```typescript
    ipcMain.handle("select-file", async () => {
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
        if (!win) return null;
        const result = await dialog.showOpenDialog(win, {
            properties: ["openFile"],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
    });
```

- [ ] **Step 2: Expose in preload.ts**

Add to the `contextBridge.exposeInMainWorld("taskflow", { ... })` object:

```typescript
    selectFile: (): Promise<string | null> => ipcRenderer.invoke("select-file"),
```

- [ ] **Step 3: Update the TaskflowBridge type in env.d.ts**

In `packages/ui/src/env.d.ts`, add to the `TaskflowBridge` interface (after `selectThemeFile`):

```typescript
    selectFile(): Promise<string | null>;
```

- [ ] **Step 4: Verify Electron build**

Run: `cd electron && bun run build`
Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add electron/src/main.ts electron/src/preload.ts packages/ui/src/env.d.ts
git commit -m "feat(electron): add selectFile IPC for flow input file picker"
```

---

### Task 8: UI — Flow store accepts inputValues

**Files:**
- Modify: `packages/ui/src/stores/flow-store.ts:22-26,134-139`

- [ ] **Step 1: Add inputValues to FlowStartParams**

Update the `FlowStartParams` interface (line 22):

```typescript
interface FlowStartParams {
    taskId?: string;
    projectId?: string;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

No other changes needed — `startFlow` already passes the full `params` object to `sendRequest`, so `inputValues` will flow through automatically.

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/flow-store.ts
git commit -m "feat(flow): extend FlowStartParams with inputValues"
```

---

### Task 9: UI — FlowInputDialog component

**Files:**
- Create: `packages/ui/src/components/flows/FlowInputDialog.tsx`

- [ ] **Step 1: Create FlowInputDialog component**

```typescript
import { useState, useCallback } from "react";
import type { FlowInputDefinition } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

interface FlowInputDialogProps {
    open: boolean;
    flowName: string;
    inputs: FlowInputDefinition[];
    onSubmit: (values: Record<string, string>) => void;
    onCancel: () => void;
}

function FlowInputDialog({ open, flowName, inputs, onSubmit, onCancel }: FlowInputDialogProps) {
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(inputs.map((input) => [input.id, ""])),
    );

    const updateValue = useCallback((id: string, value: string) => {
        setValues((prev) => ({ ...prev, [id]: value }));
    }, []);

    const handleFilePick = useCallback(
        async (id: string) => {
            const filePath = await window.taskflow?.selectFile?.();
            if (filePath) {
                updateValue(id, filePath);
            }
        },
        [updateValue],
    );

    const allFilled = inputs.every((input) => values[input.id]?.trim());

    const handleSubmit = useCallback(() => {
        if (allFilled) onSubmit(values);
    }, [allFilled, values, onSubmit]);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Flow Input: {flowName}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                    {inputs.map((input) => (
                        <div key={input.id} className="flex flex-col gap-1.5">
                            <Label htmlFor={`flow-input-${input.id}`}>{input.label}</Label>
                            <div className="flex gap-2">
                                <Input
                                    id={`flow-input-${input.id}`}
                                    value={values[input.id] ?? ""}
                                    onChange={(e) => updateValue(input.id, e.target.value)}
                                    placeholder={
                                        input.type === "filepath" ? "Select a file..." : ""
                                    }
                                    className="flex-1"
                                />
                                {input.type === "filepath" && (
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => void handleFilePick(input.id)}
                                        title="Browse..."
                                    >
                                        <FolderOpen className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!allFilled}>
                        Start Flow
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { FlowInputDialog };
```

- [ ] **Step 2: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/flows/FlowInputDialog.tsx
git commit -m "feat(flow): add FlowInputDialog component for collecting flow inputs"
```

---

### Task 10: UI — Workspace integration

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Add state and dialog for flow input**

Add imports at the top:

```typescript
import { FlowInputDialog } from "@/components/flows/FlowInputDialog";
```

Import `FlowInputDefinition` from `@taskflow/shared` (add to the existing `@taskflow/shared` import):

```typescript
import type { FlowInputDefinition } from "@taskflow/shared";
```

Add state inside the Workspace component (near the other useState calls):

```typescript
    const [flowInputState, setFlowInputState] = useState<{
        flowId: string;
        flowName: string;
        inputs: FlowInputDefinition[];
        owner: { taskId?: string; projectId?: string; flowId: string };
    } | null>(null);
```

- [ ] **Step 2: Update handleStartFlow to check for inputs**

Replace the `handleStartFlow` function (lines 480-488):

```typescript
    const handleStartFlow = (flowId: string) => {
        const owner = taskId
            ? { taskId, flowId }
            : workspace.project
              ? { projectId: workspace.project.id, flowId }
              : null;
        if (!owner) return;

        const flow = useFlowStore.getState().flows.find((f) => f.id === flowId);
        if (flow?.inputs && flow.inputs.length > 0) {
            setFlowInputState({
                flowId,
                flowName: flow.name,
                inputs: flow.inputs,
                owner,
            });
            return;
        }

        void useFlowStore.getState().startFlow(owner);
    };
```

- [ ] **Step 3: Add callback for dialog submission**

Add after `handleStartFlow`:

```typescript
    const handleFlowInputSubmit = useCallback(
        (values: Record<string, string>) => {
            if (!flowInputState) return;
            void useFlowStore.getState().startFlow({
                ...flowInputState.owner,
                inputValues: values,
            });
            setFlowInputState(null);
        },
        [flowInputState],
    );
```

- [ ] **Step 4: Render FlowInputDialog in the JSX**

Add the dialog component in the JSX, alongside other dialogs rendered by Workspace (find the return statement and add before the closing fragment or wrapper):

```typescript
            {flowInputState && (
                <FlowInputDialog
                    open
                    flowName={flowInputState.flowName}
                    inputs={flowInputState.inputs}
                    onSubmit={handleFlowInputSubmit}
                    onCancel={() => setFlowInputState(null)}
                />
            )}
```

- [ ] **Step 5: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat(flow): show FlowInputDialog when starting a flow with inputs"
```

---

### Task 11: UI — FlowEditor inputs section

**Files:**
- Modify: `packages/ui/src/components/flows/FlowEditor.tsx`

- [ ] **Step 1: Add inputs state and management functions**

Add import for `FlowInputDefinition` (extend the existing `@taskflow/shared` import):

```typescript
import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowActionEntry,
    ActionDefinition,
    SessionType,
    FlowInputDefinition,
} from "@taskflow/shared";
```

Add state after the `actions` state (line 53):

```typescript
    const [inputs, setInputs] = useState<FlowInputDefinition[]>(flow?.inputs ?? []);
```

Add management callbacks after the existing action callbacks:

```typescript
    const addInput = useCallback(() => {
        setInputs((prev) => [...prev, { id: "", label: "", type: "text" }]);
    }, []);

    const removeInput = useCallback((index: number) => {
        setInputs((prev) => prev.filter((_, i) => i !== index));
    }, []);

    const updateInput = useCallback(
        (index: number, updates: Partial<FlowInputDefinition>) => {
            setInputs((prev) =>
                prev.map((input, i) => (i === index ? { ...input, ...updates } : input)),
            );
        },
        [],
    );
```

- [ ] **Step 2: Update handleSave to include inputs**

In `handleSave` (line 139), add `inputs` to the saved object. Update the `onSave` call to include `inputs` (only if non-empty):

```typescript
        onSave({
            id: flow?.id ?? crypto.randomUUID(),
            projectId,
            name: name.trim(),
            description: description.trim(),
            actions: normalizedActions,
            inputs: inputs.length > 0 ? inputs : undefined,
            createdAt: flow?.createdAt ?? now,
            updatedAt: now,
        });
```

Also add `inputs` to the `handleSave` dependency array.

- [ ] **Step 3: Update isValid to check inputs**

Extend `isValid` to check that inputs (if any) have non-empty `id` and `label`, and unique `id` values:

```typescript
    const isValid =
        name.trim() !== "" &&
        actions.length > 0 &&
        actions.every((entry) => {
            if (!("inline" in entry) || !entry.inline) return true;
            return (
                entry.inline.name.trim() !== "" &&
                entry.inline.prompt.trim() !== "" &&
                (entry.inline.sessionType === "shell" ||
                    entry.inline.agentOptions?.type === entry.inline.sessionType)
            );
        }) &&
        inputs.every((input) => input.id.trim() !== "" && input.label.trim() !== "") &&
        new Set(inputs.map((i) => i.id)).size === inputs.length;
```

- [ ] **Step 4: Add inputs UI section in the JSX**

Add the inputs section before the Actions section (before the `<div className="flex flex-col gap-2">` that contains Actions). Place it after the Project select:

```tsx
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Label>Inputs</Label>
                            <Button variant="outline" size="sm" onClick={addInput}>
                                <Plus className="mr-1 h-3 w-3" /> Add Input
                            </Button>
                        </div>
                        <div className="flex flex-col gap-2">
                            {inputs.map((input, i) => (
                                <div
                                    key={i}
                                    className="bg-muted/50 flex items-start gap-2 rounded-md border p-3"
                                >
                                    <div className="flex flex-1 flex-col gap-2">
                                        <div className="flex gap-2">
                                            <Input
                                                value={input.id}
                                                onChange={(e) =>
                                                    updateInput(i, { id: e.target.value })
                                                }
                                                placeholder="Input ID"
                                                className="flex-1"
                                            />
                                            <Select
                                                value={input.type}
                                                onValueChange={(v) =>
                                                    updateInput(i, {
                                                        type: v as "text" | "filepath",
                                                    })
                                                }
                                            >
                                                <SelectTrigger className="w-[120px]">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="text">Text</SelectItem>
                                                    <SelectItem value="filepath">
                                                        File Path
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Input
                                            value={input.label}
                                            onChange={(e) =>
                                                updateInput(i, { label: e.target.value })
                                            }
                                            placeholder="Display label"
                                        />
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="mt-1 h-6 w-6"
                                        onClick={() => removeInput(i)}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
```

- [ ] **Step 5: Verify build**

Run: `cd packages/ui && bun run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/flows/FlowEditor.tsx
git commit -m "feat(flow): add inputs section to FlowEditor"
```

---

### Task 12: Full build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build`
Expected: Clean build across all packages.

- [ ] **Step 2: Run lint**

Run: `cd /Users/kuindji/Projects/taskflow && bun run lint`
Expected: No new lint errors.

- [ ] **Step 3: Fix any issues found and commit**

If issues found, fix and commit with:

```bash
git commit -m "fix(flow): address build/lint issues in flow input feature"
```
