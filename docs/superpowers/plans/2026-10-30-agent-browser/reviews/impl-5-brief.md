Implement docs/superpowers/plans/2026-10-30-agent-browser/05-electron-host.md in this repository, step by step, exactly as written.
Read first: the plan index docs/superpowers/plans/2026-10-30-agent-browser.md (Cross-section interfaces, Global Constraints), handoff.md in the same folder (Facts, Deviations), and the section file.
Rules:
- Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
- Follow the TDD order: write the test, see it fail, implement, see it pass.
- Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
- Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
- Don't touch files the section doesn't list, except to fix a compile error the section causes.
Final message: the commits made, the commands run with pass/fail, and any deviations.
Section-specific:
- Skip Step 8 (the manual smoke test); the reviewing session runs it. Do Step 9's commit after Step 7 builds cleanly.
- The working reference for the Electron glue is docs/superpowers/plans/2026-10-30-agent-browser/spike/main.cjs.
- Never commit electron/package.json if its only change is a version bump you didn't make.
