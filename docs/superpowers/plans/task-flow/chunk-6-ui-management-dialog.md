# Chunk 6: UI — Flow Management Dialog

### Task 11: Flow Management Dialog

**Files:**
- Create: `packages/ui/src/components/flows/FlowManagementDialog.tsx`
- Create: `packages/ui/src/components/flows/FlowEditor.tsx`
- Create: `packages/ui/src/components/flows/StepEditor.tsx`

- [ ] **Step 1: Create StepEditor component**

Create `packages/ui/src/components/flows/StepEditor.tsx`:

```typescript
import { useState, useCallback } from "react";
import type { StepDefinition } from "@taskflow/shared";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select";
import { AgentOptionsPanel } from "../workspace/AgentOptionsPanel";

interface StepEditorProps {
  step: StepDefinition | null; // null = creating new
  onSave: (step: StepDefinition) => void;
  onCancel: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
}

function StepEditor({
  step,
  onSave,
  onCancel,
  onDelete,
  deleteDisabled = false,
  deleteDisabledReason,
}: StepEditorProps) {
  const [name, setName] = useState(step?.name ?? "");
  const [prompt, setPrompt] = useState(step?.prompt ?? "");
  const [sessionType, setSessionType] = useState<"claude" | "codex" | "shell">(
    step?.sessionType ?? "claude"
  );
  const [agentOptions, setAgentOptions] = useState(step?.agentOptions);

  const handleSave = useCallback(() => {
    const now = new Date().toISOString();
    onSave({
      id: step?.id ?? crypto.randomUUID(),
      name: name.trim(),
      prompt,
      sessionType,
      agentOptions: sessionType === "shell" ? undefined : agentOptions,
      createdAt: step?.createdAt ?? now,
      updatedAt: now,
    });
  }, [step, name, prompt, sessionType, agentOptions, onSave]);

  const isValid = name.trim() !== "" && prompt.trim() !== "";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Label htmlFor="step-name">Name</Label>
        <Input id="step-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Plan Review" />
      </div>
      <div>
        <Label htmlFor="step-session-type">Session Type</Label>
        <Select value={sessionType} onValueChange={(v) => setSessionType(v as typeof sessionType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="shell">Shell</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1">
        <Label htmlFor="step-prompt">Prompt</Label>
        <Textarea
          id="step-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Instructions for the agent..."
          className="min-h-[200px] font-mono text-sm"
        />
      </div>
      {(sessionType === "claude" || sessionType === "codex") && (
        <div className="border-border rounded-md border p-1">
          <AgentOptionsPanel agentType={sessionType} onChange={setAgentOptions} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        {step && (
          <Button
            variant="destructive"
            onClick={onDelete}
            disabled={!onDelete || deleteDisabled}
            title={deleteDisabledReason}
          >
            Delete Step
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={!isValid}>Save Step</Button>
      </div>
      {step && deleteDisabledReason && (
        <p className="text-xs text-muted-foreground">{deleteDisabledReason}</p>
      )}
    </div>
  );
}

export { StepEditor };
```

- [ ] **Step 2: Create FlowEditor component**

Create `packages/ui/src/components/flows/FlowEditor.tsx`:

```typescript
import { useState, useCallback } from "react";
import type { FlowDefinition, FlowStepEntry, StepDefinition } from "@taskflow/shared";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ChevronUp, ChevronDown, X, Plus } from "lucide-react";

interface FlowEditorProps {
  flow: FlowDefinition | null; // null = creating new
  globalSteps: StepDefinition[];
  onSave: (flow: FlowDefinition) => void;
  onCancel: () => void;
}

function FlowEditor({ flow, globalSteps, onSave, onCancel }: FlowEditorProps) {
  const [name, setName] = useState(flow?.name ?? "");
  const [description, setDescription] = useState(flow?.description ?? "");
  const [steps, setSteps] = useState<FlowStepEntry[]>(flow?.steps ?? []);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, [steps.length]);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addGlobalStep = useCallback((step: StepDefinition) => {
    setSteps((prev) => [...prev, {
      id: crypto.randomUUID(),
      stepId: step.id,
      label: step.name,
    }]);
  }, []);

  const addInlineStep = useCallback(() => {
    setSteps((prev) => [...prev, {
      id: crypto.randomUUID(),
      inline: { name: "New Step", prompt: "", sessionType: "claude" },
    }]);
  }, []);

  const updateInlineStep = useCallback(
    (
      entryId: string,
      updates: Partial<NonNullable<FlowStepEntry["inline"]>>,
    ) => {
      setSteps((prev) =>
        prev.map((entry) =>
          entry.id === entryId && entry.inline
            ? { ...entry, inline: { ...entry.inline, ...updates } }
            : entry,
        ),
      );
    },
    [],
  );

  const handleSave = useCallback(() => {
    const now = new Date().toISOString();
    onSave({
      id: flow?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      steps,
      createdAt: flow?.createdAt ?? now,
      updatedAt: now,
    });
  }, [flow, name, description, steps, onSave]);

  const isValid = name.trim() !== "" && steps.length > 0;

  // Resolve step name for display
  const getStepName = (entry: FlowStepEntry): string => {
    if (entry.label) return entry.label;
    if (entry.inline) return entry.inline.name;
    if (entry.stepId) {
      const global = globalSteps.find((s) => s.id === entry.stepId);
      return global?.name ?? "Unknown step";
    }
    return "Unknown";
  };

  const getStepType = (entry: FlowStepEntry): string => {
    if (entry.inline) return entry.inline.sessionType;
    if (entry.stepId) {
      const global = globalSteps.find((s) => s.id === entry.stepId);
      return global?.sessionType ?? "?";
    }
    return "?";
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Label htmlFor="flow-name">Name</Label>
        <Input id="flow-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Feature Development" />
      </div>
      <div>
        <Label htmlFor="flow-desc">Description</Label>
        <Input id="flow-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Full feature lifecycle..." />
      </div>

      {/* Steps list with up/down reorder buttons */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Steps</Label>
          <div className="flex gap-1">
            {globalSteps.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-3 w-3 mr-1" /> From Library
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {globalSteps.map((step) => (
                    <DropdownMenuItem key={step.id} onClick={() => addGlobalStep(step)}>
                      {step.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" onClick={addInlineStep}>
              <Plus className="h-3 w-3 mr-1" /> Inline Step
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {steps.map((entry, i) => (
            <div key={entry.id} className="bg-muted rounded border p-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                    <ChevronUp className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </div>
                <span className="flex-1 text-sm">{getStepName(entry)}</span>
                <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded">{getStepType(entry)}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeStep(i)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {entry.inline && (
                <div className="mt-3 grid gap-2">
                  <Input
                    value={entry.inline.name}
                    onChange={(e) => updateInlineStep(entry.id, { name: e.target.value })}
                    placeholder="Inline step name"
                  />
                  <Select
                    value={entry.inline.sessionType}
                    onValueChange={(value) =>
                      updateInlineStep(entry.id, {
                        sessionType: value as "claude" | "codex" | "shell",
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="claude">Claude</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="shell">Shell</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea
                    value={entry.inline.prompt}
                    onChange={(e) => updateInlineStep(entry.id, { prompt: e.target.value })}
                    placeholder="Inline step prompt"
                    className="min-h-[120px] font-mono text-sm"
                  />
                </div>
              )}
            </div>
          ))}
          {steps.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-4">No steps added yet</div>
          )}
        </div>
      </div>

      {/* Help text */}
      <div className="p-3 bg-blue-950/30 border border-blue-900/50 rounded text-xs text-muted-foreground">
        <p className="text-blue-400 mb-1">Step Prompt Tips</p>
        <p>Each step's agent receives the task description automatically.</p>
        <p>Use <code className="bg-muted px-1 rounded">taskflow-cli artifact save &lt;type&gt;</code> to save outputs.</p>
        <p>Use <code className="bg-muted px-1 rounded">taskflow-cli step complete</code> when done.</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={handleSave} disabled={!isValid}>Save Flow</Button>
      </div>
    </div>
  );
}

export { FlowEditor };
```

- [ ] **Step 3: Create FlowManagementDialog component**

Create `packages/ui/src/components/flows/FlowManagementDialog.tsx`. This follows the two-panel layout from `SettingsModal.tsx` (`packages/ui/src/components/settings/SettingsModal.tsx`):

```typescript
import { useState, useEffect, useCallback, useMemo } from "react";
import { Dialog, DialogContent } from "../ui/dialog";
import { Button } from "../ui/button";
import { Plus } from "lucide-react";
import { useFlowStore } from "../../stores/flow-store";
import { FlowEditor } from "./FlowEditor";
import { StepEditor } from "./StepEditor";
import type { FlowDefinition, StepDefinition } from "@taskflow/shared";

interface FlowManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function FlowManagementDialog({ open, onOpenChange }: FlowManagementDialogProps) {
  const flows = useFlowStore((s) => s.flows);
  const steps = useFlowStore((s) => s.steps);
  const { fetchFlows, fetchSteps, saveFlow, saveStep, deleteFlow, deleteStep } = useFlowStore.getState();
  const [tab, setTab] = useState<"flows" | "steps">("flows");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) { fetchFlows(); fetchSteps(); }
  }, [open]);

  const selectedFlow = tab === "flows" ? flows.find((f) => f.id === selectedId) ?? null : null;
  const selectedStep = tab === "steps" ? steps.find((s) => s.id === selectedId) ?? null : null;
  const referencingFlowsByStepId = useMemo(
    () =>
      new Map(
        steps.map((step) => [
          step.id,
          flows.filter((flow) => flow.steps.some((entry) => entry.stepId === step.id)),
        ]),
      ),
    [flows, steps],
  );

  const handleSaveFlow = useCallback(async (flow: FlowDefinition) => {
    await saveFlow(flow);
    setSelectedId(flow.id);
    setCreating(false);
  }, [saveFlow]);

  const handleSaveStep = useCallback(async (step: StepDefinition) => {
    await saveStep(step);
    setSelectedId(step.id);
    setCreating(false);
  }, [saveStep]);

  const handleDeleteStep = useCallback(async (stepId: string) => {
    await deleteStep(stepId);
    setSelectedId(null);
    setCreating(false);
  }, [deleteStep]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[70vh] flex p-0">
        {/* Left panel: list */}
        <div className="w-52 border-r flex flex-col">
          <div className="p-2 border-b flex items-center justify-between">
            <div className="flex gap-1">
              <Button variant={tab === "flows" ? "default" : "ghost"} size="sm" onClick={() => { setTab("flows"); setSelectedId(null); setCreating(false); }}>Flows</Button>
              <Button variant={tab === "steps" ? "default" : "ghost"} size="sm" onClick={() => { setTab("steps"); setSelectedId(null); setCreating(false); }}>Steps</Button>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setSelectedId(null); setCreating(true); }}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {tab === "flows" && flows.map((f) => (
              <button key={f.id} onClick={() => { setSelectedId(f.id); setCreating(false); }}
                className={`w-full text-left p-2 rounded text-sm ${selectedId === f.id ? "bg-accent" : "hover:bg-muted"}`}>
                <div>{f.name}</div>
                <div className="text-xs text-muted-foreground">{f.steps.length} steps</div>
              </button>
            ))}
            {tab === "steps" && steps.map((s) => (
              <button key={s.id} onClick={() => { setSelectedId(s.id); setCreating(false); }}
                className={`w-full text-left p-2 rounded text-sm ${selectedId === s.id ? "bg-accent" : "hover:bg-muted"}`}>
                <div>{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.sessionType}</div>
              </button>
            ))}
          </div>
        </div>
        {/* Right panel: editor */}
        <div className="flex-1 overflow-y-auto">
          {tab === "flows" && (creating || selectedFlow) && (
            <FlowEditor flow={creating ? null : selectedFlow} globalSteps={steps} onSave={handleSaveFlow}
              onCancel={() => { setCreating(false); setSelectedId(null); }} />
          )}
          {tab === "steps" && (creating || selectedStep) && (
            <StepEditor
              step={creating ? null : selectedStep}
              onSave={handleSaveStep}
              onCancel={() => { setCreating(false); setSelectedId(null); }}
              onDelete={selectedStep ? () => handleDeleteStep(selectedStep.id) : undefined}
              deleteDisabled={
                !!selectedStep && (referencingFlowsByStepId.get(selectedStep.id)?.length ?? 0) > 0
              }
              deleteDisabledReason={
                !!selectedStep && (referencingFlowsByStepId.get(selectedStep.id)?.length ?? 0) > 0
                  ? `Used by ${referencingFlowsByStepId.get(selectedStep.id)!.map((flow) => flow.name).join(", ")}`
                  : undefined
              }
            />
          )}
          {!creating && !selectedFlow && !selectedStep && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select an item or click + to create
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { FlowManagementDialog };
```

- [ ] **Step 4: Add "Flows" button to app chrome**

Find where the Settings button is rendered. Check `packages/ui/src/components/sidebar/TaskSidebar.tsx` and `packages/ui/src/components/AppShell.tsx` — the Settings button is in the sidebar's bottom controls area. Add a Flows button next to it (use `Workflow` icon from lucide-react) that toggles `FlowManagementDialog` open state.

When you add delete affordances in the dialog:

- Flow deletion can stay unconditional.
- Step deletion must be disabled whenever that step is referenced by one or more flows.
- Show the reason inline in the dialog so the user can remove the step from those flows first.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/flows/
git commit -m "feat: add Flow Management dialog with step and flow editors"
```
