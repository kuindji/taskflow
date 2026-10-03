# Chain protocol: TSK-3 move session

This work runs as a chain of fresh Claude sessions, one step per session, so each keeps a small context. Every session follows this file.

## Every session

1. Read `handoff.md` (status and the **Next step** line), then the plan index `../2026-10-03-move-session.md`. Read only the files your step needs.
2. Do exactly the one step named under **Next step**. Don't start the following one.
3. Before handing off:
   - commit your work (no `Co-Authored-By` trailer);
   - update `handoff.md`: the status row, facts the next step needs, and the new **Next step** line;
   - commit `handoff.md`;
   - `task-tray log add TSK-3 --type info "<one line>"`, plus `--type commit` for each commit.
4. Start the next session, then close this one:

```bash
taskflow-cli agent run claude --model opus --effort high --permission-mode bypassPermissions \
  --label "TSK-3 · <next step short name>" \
  --prompt "Continue TSK-3 (move session between owners). Follow docs/superpowers/plans/2026-10-03-move-session/chain.md exactly: read handoff.md and do the step named under Next step."
taskflow-cli session close
```

Stop the chain (don't start a next session) and run `taskflow-cli notify "TSK-3: <why>"` instead when:
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
   - **Any confirmed blocker or major:** run round N+1 (Mode B `codex exec`, model `-m gpt-6.1-sol`, `-s read-only`, read the `codex-review` skill first). Brief it like round 2's prompt: check that round N's fixes hold and look for new problems. Save its output to `reviews/round-(N+1).md`. Running it in the background and waiting for it in the same session is fine. Then set **Next step** to "Plan review round N+1".
   - **Only minors or nothing confirmed:** reviews are done. Set **Next step** to "Implement Section 1".
4. Round cap: if round 5 still has a confirmed blocker or major, stop the chain and notify the user.

## Implementation steps ("Implement Section K")

1. Follow `0K-*.md` step by step, test-first, exactly as written. If the plan is wrong against the real code, make the smallest correct fix and record it under "Deviations from the spec" in `handoff.md`.
2. Run the section's checks: typecheck, eslint and prettier on the changed files, the section's tests, and the full suite of each package you touched. Rerun a single unrelated flaky backend test once before investigating it.
3. Review your own diff for the section before committing (CLAUDE.md: avoid duplication, no `as any`, no unused exports, reuse types).
4. Next step after Section K is "Implement Section K+1". Section 6 ends with the final whole-change review and the close-out. After it, stop the chain and notify the user that TSK-3 is ready for review and push.
