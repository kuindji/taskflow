Pending session creation can now delay independent schedules and subsequent backend initialization. Backend typechecking passed, but the focused tests were blocked by the read-only sandbox's mkdtemp restriction.

Review comment:

- [P2] Avoid awaiting pending spawns in the due-check loop — /Users/kuindji/Projects/taskflow/packages/backend/src/services/scheduler-service.ts:127-127
  When an overdue job's spawn waits for the existing native-session launch lock, this sequential loop stops checking later schedules because `scheduleNext()` now awaits `execute()` through session creation. Reproducing startup with two overdue jobs and a pending first spawn leaves the second untouched until the next 30-second tick. It also keeps `init()` pending, delaying remote-agent startup and change-tracker registration in `index.ts`. Dispatch admitted attempts without holding the due scan and initialization open.
