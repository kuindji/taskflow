Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/10-desktop-updater.md in this repository, step by step, exactly as written.
Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
The t3code source at commit 32ecd717 is checked out read-only at /private/tmp/claude-501/-Users-kuindji-Projects-taskflow/ad196933-0661-4f11-8acd-cd315fa91ccd/scratchpad/t3code. The files to port are apps/desktop/src/updates/updateMachine.ts and apps/desktop/src/updates/updateMachine.test.ts there.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message (one commit, Step 9). No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
- Stage files by explicit path only. Never `git add -A`, `git commit -a`, `git stash`, `git checkout -- .` or `git reset`.
- Step 8 (packaged-app manual check) can't run in your sandbox: skip it and say so. The gate session handles it. Don't edit handoff.md.
- In your sandbox some backend tests fail for environmental reasons; typecheck needs `TMPDIR=/private/tmp`. Judge UI tests file by file (`bun test packages/ui` as one command has pre-existing mock.module leakage failures).
Final message: the commits made, the commands run with pass/fail, and any deviations.
