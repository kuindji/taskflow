Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/02-auth-local-clients.md in this repository, step by step, exactly as written. Do Tasks 2.1 to 2.4 only; Task 2.5 (manual verification with the GUI app) is done by the supervising session, so skip it.
Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
- Don't edit handoff.md; report everything in your final message instead.
- In your sandbox some backend tests fail for environmental reasons (process-stopper, watchers: `ps` EPERM, no FS events), and typecheck needs `TMPDIR=/private/tmp`. Ignore those environmental failures; the supervisor reruns suites outside the sandbox.
Final message: the commits made, the commands run with pass/fail, and any deviations.
