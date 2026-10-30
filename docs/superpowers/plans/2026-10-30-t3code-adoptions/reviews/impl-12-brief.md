Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/12-gitlab.md in this repository, step by step, exactly as written.
Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
- Don't edit handoff.md; report everything in your final message instead.
- The dual-provider host question in Step 3 is already resolved: see "Planner decisions" at the end of the section file and design.md §9.
- Step 8: there is no browser in your sandbox. Cover the acceptance cases with the fake-backed tests and say which cases you couldn't check by hand.
- PROTOCOL_VERSION is currently 2 (Section 8); bump it to 3.
Final message: the commits made, the commands run with pass/fail, and any deviations.
