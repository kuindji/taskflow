You are reviewing an implementation plan (not code) for the Taskflow repository at the current working directory. Read-only: do not modify files.

Feature (TaskTray TSK-4, "running dev servers"): agents register dev servers they start (PID + label) via new `taskflow-cli devserver add|list|remove` commands; the agent system prompt tells them to; the desktop UI shows a sidebar button + popover listing all registered servers across connected backends with a Stop button. Taskflow tracks nothing on its own (no polling/scanning). Stop = PID-reuse guard (process start time later than registeredAt => different process, remove record, no signal), then SIGTERM the PID and all descendants (one `ps` snapshot), wait, SIGKILL survivors; errors shown in UI.

Read, in order:
1. Spec: docs/superpowers/specs/2026-10-11-dev-servers-design.md
2. Plan index: docs/superpowers/plans/2026-10-11-dev-servers.md (fixed cross-section interfaces, global constraints, review focus)
3. Sections: docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md, 02-backend-api.md, 03-cli-prompt.md, 04-ui.md, 05-verify.md
4. The real code each section touches (verify every snippet against it): packages/shared/src (types, constants.ts MSG), packages/backend/src (config.ts, index.ts, api/router.ts, api/routes.ts, api/routes/notification-routes.ts, handlers/notification.ts, services/notification-store.ts, services/internal-agent-skill.ts, services/taskflow-cli.sh, services/taskflow-cli-bin.ts), packages/backend/tests (api/routes.test.ts, services/taskflow-cli.test.ts, services/taskflow-cli-bin-session.test.ts, services/internal-agent-skill.test.ts, expect-rejects.ts), packages/ui/src (stores/notification-store.ts, stores/backend-store.ts, lib/backend-scope.ts, lib/connection-registry.ts, stores/store-reset.ts and its test, components/sidebar/TaskSidebar.tsx, NotificationPopover.tsx, stores/aggregation.test.ts).

Look for, in priority order:
- Correctness bugs in the planned code: wrong process-tree/signal logic, PID-reuse guard math (ps etime parsing, 1s slack, clock/timezone), races in store mutations or broadcast ordering, slice/fetch races in the UI store, anything that could signal the wrong process or the agent's own process group, Windows branch mistakes.
- Snippets that will not compile or run against the real code (wrong imports, signatures, test harness APIs, helper names, file paths, line refs), or tests that would pass without the feature (vacuous) or be flaky (real-process timing).
- Contradictions between sections, or between plan and spec/index (names, types, error strings, HTTP semantics, CLI flags, prompt text).
- Spec requirements with no task; violations of global constraints (no `as any`, no eslint-disable added, no unused exports, no mock.module, both CLIs identical, commits never leave main failing typecheck).
- Missing tests for the Review Focus items.

Do not report style nits or alternative designs the spec already decided. For each finding give: id, severity (blocker/major/minor), plan file + section/task/step, the problem with evidence (quote the plan and the real code with file:line), and the concrete fix. End with a one-line verdict.
