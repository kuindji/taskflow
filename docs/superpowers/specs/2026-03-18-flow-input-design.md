# Flow Input Design

## Problem

Flows currently have no mechanism for a user to provide upfront input before execution starts. Action prompts can describe what the agent should do, but there's no way to parameterize a flow with user-provided values (e.g., a feature description, a file path to process). This forces users to either hardcode values into action prompts or rely on agents asking for input interactively.

## Solution

Allow flow definitions to declare typed input fields. When a flow with inputs is started, the UI presents a dialog for the user to fill in values. These values are stored on the `FlowRun` and made accessible to all actions via the `taskflow-cli`.

## Design

### Types

Add to `packages/shared/src/types/flow.ts`:

```typescript
interface FlowInputDefinition {
    id: string;
    label: string;
    type: "text" | "filepath";
}
```

Extend `FlowDefinition`:

```typescript
interface FlowDefinition {
    // ... existing fields ...
    inputs?: FlowInputDefinition[];
}
```

Extend `FlowRun`:

```typescript
type FlowRun = FlowOwner & {
    // ... existing fields ...
    inputValues?: Record<string, string>;
};
```

Extend `FlowStartPayload`:

```typescript
interface FlowStartPayload {
    taskId?: string;
    projectId?: string;
    flowId: string;
    inputValues?: Record<string, string>;
}
```

### Backend — FlowRunner

- `startFlow(owner, flow, inputValues?)` accepts an optional `inputValues` parameter.
- If `flow.inputs` is defined and non-empty, validate that every input `id` has a corresponding non-empty string value in `inputValues`. Throw if any are missing.
- If `flow.inputs` is undefined or empty, `inputValues` is ignored.
- Store `inputValues` on the `FlowRun` object before persisting.
- `inputValues` is immutable after creation — it survives pause, resume, and jump operations.

### Backend — HTTP API

New endpoints in `packages/backend/src/api/routes.ts`:

- `GET /api/flow/input/:ownerId/:flowId` — returns `{ inputs: Record<string, string> }` (all input values).
- `GET /api/flow/input/:ownerId/:flowId/:inputId` — returns `{ id: string, value: string }` for a single input. Returns 404 if the input ID doesn't exist.
- Both return 404 if the flow run is not found.

### Backend — WebSocket Handler

The `FLOW_START` handler in `packages/backend/src/handlers/flow.ts` passes `payload.inputValues` through to `flowRunner.startFlow()`.

### CLI Script

Add a `flow` command to the CLI script in `packages/backend/src/services/internal-agent-skill.ts`:

- `taskflow-cli flow input` — lists all input values as JSON.
- `taskflow-cli flow input <id>` — outputs the raw value of a single input (plain text, no JSON wrapping, suitable for shell scripting).

Both require `TASKFLOW_FLOW_ID` to be set.

### System Prompt & Skill File

Update the flow instructions in `internal-agent-skill.ts`:

- Add to `PROMPT_FLOW`:
  ```
  - Get all flow inputs: `taskflow-cli flow input`
  - Get a specific flow input: `taskflow-cli flow input <id>`
  ```
- Add corresponding section to `INTERNAL_AGENT_SKILL_MARKDOWN`.

### UI — FlowInputDialog

New component `packages/ui/src/components/flows/FlowInputDialog.tsx`:

- Modal dialog shown when starting a flow that has `inputs` defined.
- Renders one form field per `FlowInputDefinition`:
  - `type: "text"` — standard text input.
  - `type: "filepath"` — text input with a file picker button that invokes Electron's `dialog.showOpenDialog`.
- All fields are required. Submit button disabled until all fields have non-empty values.
- On submit: calls `startFlow()` with the collected `inputValues`.
- If the flow has no inputs (or `inputs` is empty), skip the dialog and start immediately (preserving current behavior).

### UI — FlowEditor

Extend `packages/ui/src/components/flows/FlowEditor.tsx` with an "Inputs" section:

- List of input definitions, each with `id`, `label`, and `type` fields.
- Add/remove buttons for managing inputs.
- `id` field is a text input (must be unique within the flow).
- `label` field is a text input.
- `type` field is a dropdown with options: "text", "filepath".

### UI — Flow Store

Extend `startFlow` in `packages/ui/src/stores/flow-store.ts` to accept and forward `inputValues`.

### UI — Workspace

The flow start trigger in `Workspace.tsx` needs to:

1. Look up the `FlowDefinition` to check if it has inputs.
2. If inputs exist, show `FlowInputDialog` instead of starting immediately.
3. If no inputs, start immediately (current behavior).

### UI — FlowPanel

No changes needed. Input values are stored on the run but agents access them via CLI, not via UI display.

## Files to Modify

| File | Change |
|------|--------|
| `packages/shared/src/types/flow.ts` | Add `FlowInputDefinition`, extend `FlowDefinition`, `FlowRun`, `FlowStartPayload` |
| `packages/backend/src/services/flow-runner.ts` | Accept and validate `inputValues` in `startFlow()` |
| `packages/backend/src/handlers/flow.ts` | Pass `inputValues` from payload to runner |
| `packages/backend/src/api/routes.ts` | Add `GET /api/flow/input/...` endpoints |
| `packages/backend/src/services/internal-agent-skill.ts` | Add `flow input` CLI command, update prompts and skill file |
| `packages/ui/src/components/flows/FlowInputDialog.tsx` | New component: input collection dialog |
| `packages/ui/src/components/flows/FlowEditor.tsx` | Add inputs section to flow editor |
| `packages/ui/src/stores/flow-store.ts` | Extend `startFlow` to accept `inputValues` |
| `packages/ui/src/components/workspace/Workspace.tsx` | Show input dialog when flow has inputs |
