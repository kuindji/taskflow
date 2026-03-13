# Chunk 7: UI — Flow Execution Panel

### Task 12: Flow Execution Panel

**Files:**
- Create: `packages/ui/src/components/flows/FlowPanel.tsx`

- [ ] **Step 1: Create FlowPanel component**

Create `packages/ui/src/components/flows/FlowPanel.tsx`:

```typescript
import { useState, useCallback } from "react";
import { useFlowStore } from "../../stores/flow-store";
import { Button } from "../ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "../ui/alert-dialog";
import { Check, X, SkipForward, Pause, Play, Square, Loader2 } from "lucide-react";
import type { FlowDefinition, FlowStepState } from "@taskflow/shared";

interface FlowPanelProps {
  taskId: string;
  flowDefinitions: FlowDefinition[];
}

function FlowPanel({ taskId, flowDefinitions }: FlowPanelProps) {
  const run = useFlowStore((s) => s.activeRuns[taskId]);
  const steps = useFlowStore((s) => s.steps);
  const { skipStep, pauseFlow, resumeFlow, stopFlow, jumpToStep } = useFlowStore.getState();

  if (!run) return null;

  const flowDef = flowDefinitions.find((f) => f.id === run.flowId);
  const flowName = flowDef?.name ?? "Flow";

  const getStepName = (state: FlowStepState, index: number): string => {
    const entry = flowDef?.steps[index];
    if (!entry) return `Step ${index + 1}`;
    if (entry.label) return entry.label;
    if (entry.inline) return entry.inline.name;
    if (entry.stepId) {
      return steps.find((step) => step.id === entry.stepId)?.name ?? `Step ${index + 1}`;
    }
    return `Step ${index + 1}`;
  };

  const getStepSessionType = (index: number): string => {
    const entry = flowDef?.steps[index];
    if (entry?.inline) return entry.inline.sessionType;
    if (entry?.stepId) {
      return steps.find((step) => step.id === entry.stepId)?.sessionType ?? "agent";
    }
    return "agent";
  };

  const [jumpConfirm, setJumpConfirm] = useState<{ index: number; name: string } | null>(null);

  const handleJump = useCallback((index: number) => {
    setJumpConfirm({ index, name: getStepName(run.steps[index], index) });
  }, [run]);

  const confirmJump = useCallback(() => {
    if (jumpConfirm) {
      jumpToStep(taskId, run.flowId, jumpConfirm.index);
      setJumpConfirm(null);
    }
  }, [jumpConfirm, taskId, run]);

  const statusIcon = (status: FlowStepState["status"]) => {
    switch (status) {
      case "completed": return <Check className="h-3 w-3 text-green-400" />;
      case "running": return <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />;
      case "failed": return <X className="h-3 w-3 text-red-400" />;
      case "skipped": return <SkipForward className="h-3 w-3 text-muted-foreground" />;
      default: return <span className="text-xs text-muted-foreground">{/* step number shown by parent */}</span>;
    }
  };

  return (
    <div className="flex flex-col h-full border-t">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium truncate">{flowName}</span>
        <div className="flex gap-1">
          {run.status === "running" && (
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => pauseFlow(taskId, run.flowId)} tooltip="Pause">
              <Pause className="h-3 w-3" />
            </Button>
          )}
          {run.status === "paused" && (
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => resumeFlow(taskId, run.flowId)} tooltip="Resume">
              <Play className="h-3 w-3" />
            </Button>
          )}
          {(run.status === "running" || run.status === "paused") && (
            <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => stopFlow(taskId, run.flowId)} tooltip="Stop">
              <Square className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {run.steps.map((step, i) => (
          <div
            key={step.stepEntryId}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer
              ${step.status === "running" ? "bg-blue-950/40 border border-blue-800/50" : ""}
              ${step.status === "completed" ? "bg-green-950/20" : ""}
              ${step.status === "failed" ? "bg-red-950/20" : ""}
              ${step.status === "pending" || step.status === "skipped" ? "opacity-50" : ""}
            `}
            onClick={() => (step.status === "completed" || step.status === "failed") ? handleJump(i) : undefined}
          >
            <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
              {step.status === "pending" ? <span className="text-muted-foreground">{i + 1}</span> : statusIcon(step.status)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="truncate">{getStepName(step, i)}</div>
              <div className="text-[10px] text-muted-foreground">{getStepSessionType(i)}</div>
            </div>
            {step.status === "running" && run.status === "running" && (
              <Button variant="ghost" size="icon" className="h-4 w-4" onClick={(e) => { e.stopPropagation(); skipStep(taskId, run.flowId); }}>
                <SkipForward className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Artifacts */}
      {run.artifacts.length > 0 && (
        <div className="border-t px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Artifacts</div>
          {run.artifacts.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-blue-400">•</span>
              <span>{a.type}</span>
              <span className="text-muted-foreground truncate text-[10px]">{a.path ?? a.text?.slice(0, 40)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Jump confirmation dialog */}
      <AlertDialog open={!!jumpConfirm} onOpenChange={(open) => !open && setJumpConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run step?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-run step &quot;{jumpConfirm?.name}&quot;?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmJump}>Re-run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export { FlowPanel };
```

Follow the visual design from the brainstorming mockup. Adjust Tailwind classes to match the existing dark theme colors used in other panels.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/flows/FlowPanel.tsx
git commit -m "feat: add Flow execution panel with step status and controls"
```

### Task 13: Integrate Flow Panel into Layout

**Files:**
- Modify: `packages/ui/src/components/AppShell.tsx`
- Modify: `packages/ui/src/components/workspace/TaskHeader.tsx`
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx`
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Add FlowPanel to AppShell**

In `packages/ui/src/components/AppShell.tsx` (layout in lines 72-129), add `FlowPanel` between the sidebar column and the file explorer column. The `AppShellProps` interface (line 7) should gain an optional `flowPanel?: ReactNode` prop. Render it conditionally between `{sidebar}` and `{fileExplorer}` in the layout grid.

The parent component that renders `AppShell` (check `App.tsx` or the main layout component) should pass:
```typescript
flowPanel={activeTaskId && activeRun ? <FlowPanel taskId={activeTaskId} flowDefinitions={flows} /> : undefined}
```

Use `useFlowStore((s) => activeTaskId ? s.activeRuns[activeTaskId] : undefined)` to check for an active run. Because the store now removes completed/failed runs from `activeRuns`, the panel will disappear automatically when the flow is no longer active. Only render the panel column when the prop is defined. Give it a fixed width (e.g., 200px) consistent with other side panels.

- [ ] **Step 2: Add Flow dropdown to TaskHeader**

In `TaskHeader.tsx`, add a new dropdown button as the first button in the header area. Pattern:

```typescript
// Import useFlowStore to get flows list
// DropdownMenu with DropdownMenuTrigger (button with "Flow" label + chevron)
// DropdownMenuContent:
//   - List of available FlowDefinitions, each as DropdownMenuItem
//   - Clicking one calls useFlowStore.startFlow(taskId, flowId)
//   - Separator
//   - "Manage Flows..." item that opens FlowManagementDialog
```

Use existing shadcn/ui `DropdownMenu` components (already used in the project).

- [ ] **Step 3: Add flow selection UI to NewTaskDialog and start orchestration to TaskCreationDialogHost**

`NewTaskDialog.tsx` should stay a pure form component. Extend its submit payload so it can return either `startWithAgent?: "claude" | "codex"` or `startWithFlowId?: string`.

Then update `TaskCreationDialogHost.tsx` to own the create-and-start orchestration, because that file already handles the worktree-ready deferral path for immediate starts. Mirror the existing `pendingSessionRef` behavior with a `pendingFlowRef` so flows start only after a worktree path exists.

```typescript
// Add a toggle or radio: "Start with Agent" | "Start with Flow"
// When "Start with Flow" is selected:
//   - Show flow picker (Select component with available flows)
//   - Hide agent options
// NewTaskDialog only returns the selection upward.
//
// In TaskCreationDialogHost:
//   - create the task first
//   - if worktree=false, call flowStore.startFlow(task.id, flowId) immediately
//   - if worktree=true, defer with pendingFlowRef until task.worktree.path is populated
```

- [ ] **Step 4: Fetch flow definitions on app load**

In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, the `useEffect` at line 42-44 already calls `fetchProjects`, `fetchTasks`, `fetchSettings` when `connected` changes. Add flow fetching there:

```typescript
import { useFlowStore } from "@/stores/flow-store";
// ...
const fetchFlows = useFlowStore((s) => s.fetchFlows);
const fetchSteps = useFlowStore((s) => s.fetchSteps);

// In the existing useEffect:
void fetchFlows();
void fetchSteps();
```

For fetching flow runs when a task becomes active, add a `useEffect` in the component that uses `activeTaskId` (likely `Workspace.tsx` or wherever `useActiveWorkspace` is consumed):

```typescript
const activeTaskId = useTaskStore((s) => s.activeTaskId);
const fetchFlowRuns = useFlowStore((s) => s.fetchFlowRuns);

useEffect(() => {
  if (activeTaskId) fetchFlowRuns(activeTaskId);
}, [activeTaskId, fetchFlowRuns]);
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/AppShell.tsx packages/ui/src/components/workspace/TaskHeader.tsx packages/ui/src/components/sidebar/NewTaskDialog.tsx packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx packages/ui/src/components/sidebar/TaskSidebar.tsx packages/ui/src/App.tsx packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: integrate flow panel, header dropdown, and task creation flow selection"
```
