Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/03-remote-connectivity.md in this repository, step by step, exactly as written, in this order: Tasks 3.1, 3.2, 3.3, 3.4 (Steps 1 to 6), then Task 3.5 (under "Planner decisions"). Skip Task 3.4 Step 7 (handoff); the supervising session does it.
Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees. Stage only your own files by explicit path; never `git add -A` or `git commit -a`.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
- Line anchors in the section may have drifted; find code by landmarks.
- Section 6 already added `packages/ui/src/lib/backend-ready.ts` (`notifyBackendReady`), published by backend-store `attach`/`rehandshake`. The automatic reconnect must end in `attach` so terminals resync; don't add a second readiness path.
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Don't edit handoff.md; report everything in your final message instead.
- In your sandbox some backend tests fail for environmental reasons (process-stopper, watchers: `ps` EPERM, no FS events), and typecheck needs `TMPDIR=/private/tmp`. Ignore those environmental failures; the supervisor reruns suites outside the sandbox.
Final message: the commits made, the commands run with pass/fail, and any deviations.
