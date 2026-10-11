# Chain protocol: TSK-4 running dev servers

This work runs as a chain of fresh Claude sessions, one step per session, so each keeps a small context. Every session follows this file.

## Every session

1. Read `handoff.md` (status and the **Next step** line), then the plan index `../2026-10-11-dev-servers.md`. Read only the files your step needs.
2. Do exactly the one step named under **Next step**. Don't start the following one.
3. Before handing off:
   - commit your work (no `Co-Authored-By` trailer);
   - update `handoff.md`: the status row, facts the next step needs, and the new **Next step** line;
   - commit `handoff.md`;
   - `task-tray log add TSK-4 --type info "<one line>"`, plus `--type commit` for each commit.
4. Start the next session, then close this one:

```bash
taskflow-cli agent run claude --model opus --effort high --permission-mode bypassPermissions \
  --label "TSK-4 · <next step short name>" \
  --prompt "Continue TSK-4 (running dev servers). Follow docs/superpowers/plans/2026-10-11-dev-servers/chain.md exactly: read handoff.md and do the step named under Next step."
taskflow-cli session close
```

Stop the chain (don't start a next session) and run `taskflow-cli notify "TSK-4: <why>"` instead when:
- a step is blocked on a decision only the user can make;
- tests or typecheck fail in a way the step can't fix without changing the design;
- the review loop hits its round cap (below);
- the last step is done.

Write the reason under **Next step** in `handoff.md` before notifying.

Don't push. The user pushes after the final review.

## Review steps ("Plan review round N")

The report for round N is `reviews/round-N.md`. Then:

1. Verify every finding against the real code yourself. Codex's report is evidence, not authority. For each finding, record in `reviews/round-N-triage.md` one line: `confirmed` / `rejected`, plus why.
2. Fold confirmed findings into the plan section files and the spec's "Amendments" section. Add a line to "Plan review log" in the plan index.
3. Decide:
   - **Any confirmed blocker or major:** run round N+1 (`codex exec`, `-m gpt-6.1-sol`, `-s read-only`; read the `codex-review` skill first). Brief it to check that round N's fixes hold and to look for new problems. Save its output to `reviews/round-(N+1).md`. Running it in the background and waiting for it in the same session is fine. Then set **Next step** to "Plan review round N+1".
   - **Only minors or nothing confirmed:** reviews are done. Set **Next step** to "Implement Section 1".
4. Round cap: if round 4 still has a confirmed blocker or major, stop the chain and notify the user.

## Implementation steps ("Implement Section K")

gpt-6.1-sol implements. This Opus session briefs it, checks its work, and owns the gate.

1. Record the base: `git rev-parse HEAD` (Section 1 also writes it into `handoff.md` as the final-review base).
2. Brief Sol with a pointer to the section, not a rewrite of it. The plan is already reviewed, so don't have the brief reviewed. Write the brief to `reviews/impl-K-brief.md`:

   ```
   Implement docs/superpowers/plans/2026-10-11-dev-servers/0K-<name>.md in this repository, step by step, exactly as written.
   Read first: the plan index docs/superpowers/plans/2026-10-11-dev-servers.md (Cross-section interfaces, Global Constraints), handoff.md in the same folder (Facts, Deviations), and the section file.
   Rules:
   - Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
   - Follow the TDD order: write the test, see it fail, implement, see it pass.
   - Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
   - Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
   - Don't touch files the section doesn't list, except to fix a compile error the section causes.
   Final message: the commits made, the commands run with pass/fail, and any deviations.
   ```

   Run it in the background, and wait for it in this session:

   ```bash
   codex exec -m gpt-6.1-sol -s danger-full-access -C "$PWD" \
     -o docs/superpowers/plans/2026-10-11-dev-servers/reviews/impl-K-report.md \
     - < docs/superpowers/plans/2026-10-11-dev-servers/reviews/impl-K-brief.md \
     > docs/superpowers/plans/2026-10-11-dev-servers/reviews/impl-K.log 2>&1
   ```

   Leave reasoning effort at the config default. Before trusting the run, check that the report is non-empty and the log ends with a completed turn.
3. Verify Sol's work yourself. Its report is evidence, not proof.
   - Read `git diff <base>..HEAD` against the section file. Check for anything skipped, extra, or invented.
   - Check against CLAUDE.md: no duplication, no `as any`, no new eslint-disable, no unused exports, existing types reused, no `mock.module`.
   - Run the section's checks yourself: typecheck, eslint and prettier on the changed files, the section's tests, and the full suite of each package touched. Rerun the known flaky backend test once before investigating it.
4. Fix what's wrong. Small fixes: do them yourself, test-first, as `fix:` commits. Larger rework: send Sol a follow-up brief naming the exact problems (same command, `impl-K-fix-brief.md`), then verify again.
5. Record Sol's deviations and your fixes under "Deviations from the spec" in `handoff.md`, and its commits in the status row.
6. Next step after Section K is "Implement Section K+1". Section 5 is the exception: run it yourself rather than through Sol (manual verification, final review, close-out). After it, stop the chain and notify the user that TSK-4 is ready for review and push.
