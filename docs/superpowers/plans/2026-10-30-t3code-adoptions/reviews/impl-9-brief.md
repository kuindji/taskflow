Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/09-agent-discovery.md in this repository, step by step, exactly as written.
Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
- The section has three tasks (9.1, 9.2, 9.3), each with its own commit. Do all three in order. The planner's template decision at the end of the section file is already made; apply it.
- Stage files by explicit path only. Never `git add -A`, `git commit -a`, `git stash`, `git checkout -- .` or `git reset`.
- In your sandbox some backend tests fail for environmental reasons (process-stopper, watchers: `ps` EPERM, no FS events); typecheck needs `TMPDIR=/private/tmp`. Note such failures but don't chase them. Judge UI tests file by file (`bun test packages/ui` as one command has pre-existing mock.module leakage failures).
- Don't edit handoff.md; the gate session updates it.
Final message: the commits made, the commands run with pass/fail, and any deviations.
