# Task Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Task Flow orchestration feature that lets users define reusable multi-step workflows (plan, review, code, lint, etc.) executed as sequences of agent sessions with automatic progression and manual control.

**Architecture:** Backend-driven orchestrator — `FlowRunner` owns execution logic, but session launch/teardown still goes through shared session-lifecycle helpers so flow-spawned tabs behave exactly like manually created sessions. UI remains a pure view/control layer with a Zustand store and three new components (FlowPanel, FlowManagementDialog, TaskHeader dropdown).

**Tech Stack:** TypeScript, Bun, React, Zustand, Tailwind CSS, shadcn/ui components

**Spec:** `docs/superpowers/specs/2026-03-13-task-flow-design.md`

---

## Chunks

1. [Shared Types & Constants](./chunk-1-shared-types.md) — Tasks 1–2
2. [Backend Storage Layer](./chunk-2-backend-storage.md) — Tasks 3–4
3. [Flow Runner & Session Integration](./chunk-3-flow-runner.md) — Task 5
4. [Backend Handlers, API Routes & CLI](./chunk-4-backend-handlers.md) — Tasks 6–9
5. [UI Store](./chunk-5-ui-store.md) — Task 10
6. [UI — Flow Management Dialog](./chunk-6-ui-management-dialog.md) — Task 11
7. [UI — Flow Execution Panel](./chunk-7-ui-execution-panel.md) — Tasks 12–13
8. [End-to-End Integration & Testing](./chunk-8-integration-testing.md) — Tasks 14–16

---

## Implementation Notes

### Key files to reference during implementation:
- **Handler pattern:** `packages/backend/src/handlers/task.ts` — dependency injection, router.register
- **Store pattern:** `packages/ui/src/stores/task-store.ts` — Zustand with sendRequest
- **Session spawn:** `packages/backend/src/handlers/session.ts` — onExit callback, env vars
- **CLI generation:** `packages/backend/src/services/internal-agent-skill.ts` — shell script case statement
- **Dialog layout:** `packages/ui/src/components/settings/SettingsModal.tsx` — two-panel dialog
- **Button pattern:** `packages/ui/src/components/workspace/TaskHeader.tsx` — ghost buttons, tooltips
- **API routes:** `packages/backend/src/api/routes.ts` — register pattern, jsonResponse helper

### Environment variables injected for flow sessions:
- `TASKFLOW_TASK_ID` — existing
- `TASKFLOW_SESSION_ID` — existing
- `TASKFLOW_FLOW_ID` — new
- `TASKFLOW_STEP_ENTRY_ID` — new
- `TASKFLOW_API_URL` — existing
- `TASKFLOW_PROJECT_ID` — existing

### Workspace key reminder:
Flow-spawned sessions use the same workspace key as the task (`getTaskWorkspaceKey(taskId)`). Tabs are added via the existing `addTab` mechanism in session-store. The FlowRunner's `spawnSession` callback should trigger tab creation the same way manual session creation does.
