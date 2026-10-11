- DS2-01: holds. Primary fallback works without weakening the attached-machine filter; the new component test passes.
- DS2-02: holds. Opening and closing clear errors while preserving `"stopping"`. The new manual check has a weakness below.
- DS2-03: holds. Both holder objects typecheck against the real WS test harness.
- DS2-04: holds. The header assertions and block-bodied fake pass strict eslint.
- DS2-05: holds. Both parsers reject the amended cases and accept `--label --`.
- DS2-06: holds. Item 8 allows owner adoption while forbidding a dev-server request.

Validation used in-memory TypeScript overlays and the repository’s strict eslint configuration. Runtime probes passed all 12 planned component tests, 23 injected stopper tests, and 33 CLI status-parity cases. No files were modified; package suites and real process signalling were not run.

**DS3-01 — minor, non-blocking. The late-failure manual check can remove its target before reopening.**

Location: [05-verify.md:54](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/05-verify.md:54), Task 1, Step 2, item 10.

The plan says to wait for the request timeout, then "`kill -CONT` the backend, then reopen."

The real client timeout only deletes the pending response entry and rejects locally: `if (this.pending.delete(correlationId))`, [connection.ts:176](/Users/kuindji/Projects/taskflow/packages/ui/src/lib/connection.ts:176). It sends no cancellation. The backend still executes the queued request through `await router.handle(...)`, [server.ts:105](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:105).

After resuming, Stop can kill the registered sleep and broadcast its removal under [01-backend-core.md:1446](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/01-backend-core.md:1446). With the popover closed and its only row gone, the planned button executes `if (count === 0 && !open) return null`, [04-ui.md:1062](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-10-11-dev-servers/04-ui.md:1062).

An injected sequence reproduced this: the timeout error remained in `stopStates`, but the successful removal broadcast left zero rows and no button. Thus the check can become impossible to reopen, or appear clean because the errored row disappeared.

Concrete fix: reopen **while the backend remains stopped**, after the timeout. Assert that the registered row remains visible, its Stop button is enabled, and no timeout error appears. Resume the backend and clean up afterward. This makes the check distinguish the corrected handler from the previous implementation.

No other evidence-backed findings in Sections 1–4 or the cross-section contracts.

Verdict: Clear with non-blocking follow-ups.

