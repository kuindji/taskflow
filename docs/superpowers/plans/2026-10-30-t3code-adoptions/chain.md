# Chain protocol: adoptions from t3code

This work runs as a chain of fresh Claude sessions, one step per session, so each keeps a small context. Every session follows this file.

## Every session

1. Read `handoff.md` (status and the **Next step** line), the plan index `../2026-10-30-t3code-adoptions.md` and `design.md`. Read only the other files your step needs.
2. Do exactly the one step named under **Next step**. Don't start the following one.
3. Before handing off:
   - commit your work (no `Co-Authored-By` trailer), staging only your own files by path;
   - update `handoff.md`: the status row, facts the next step needs, and the new **Next step** line;
   - commit `handoff.md`;
   - `taskflow-cli log info "<one line>"`, plus `taskflow-cli log commit "<msg>" --hash <hash>` for each commit, when running inside a task.
4. Start the next session, then close this one:

```bash
taskflow-cli agent run claude --model opus --effort high --permission-mode bypassPermissions \
  --label "t3code adoptions · <next step short name>" \
  --prompt "Continue the t3code adoptions work. Follow docs/superpowers/plans/2026-10-30-t3code-adoptions/chain.md exactly: read handoff.md and do the step named under Next step."
taskflow-cli session close
```

Stop the chain (don't start a next session) and run `taskflow-cli notify "t3code adoptions: <why>"` instead when:
- a step is blocked on a decision only the user can make;
- the next step is an implementation step and the agent-browser chain isn't finished (its `handoff.md` doesn't say "None: complete");
- tests or typecheck fail in a way the step can't fix without changing the design;
- the review loop hits its round cap (below);
- the last step is done.

Write the reason under **Next step** in `handoff.md` before notifying.

Don't push. The user pushes after the final review.

**Another chain may be running in this working tree** while plan reviews run. Commit only the files you changed, by explicit path. Never `git add -A`, `git commit -a`, `git stash`, `git checkout -- .` or `git reset`.

## Review steps ("Plan review round N")

1. Run the review.
   - Read the `codex-review` skill.
   - Run `codex exec -m gpt-6.1-sol -s read-only` with the prompt on stdin, in the background, and wait for it.
   - Round 1 brief: review `design.md`, the index and sections 01–13 against the real code. Look for wrong file or line claims, steps that won't work, interface mismatches between sections, missing decisions from `design.md`, clients the auth work misses (`reviews/research-6-auth-surface.md` is the map), anything that breaks the app between Sections 1 and 5, and tests that can't fail.
   - Round N > 1 brief: check that round N−1's fixes hold, and look for new problems.
   - Save the output to `reviews/round-N.md`.
2. Verify every finding against the real code yourself. Codex's report is evidence, not authority. For each finding, record one line in `reviews/round-N-triage.md`: `confirmed` or `rejected`, plus why.
3. Fold confirmed findings into the section files, and into `design.md` when a decision changes. Add a line to "Plan review log" in the index.
4. Decide:
   - **any confirmed blocker or major:** set **Next step** to "Plan review round N+1";
   - **only minors or nothing confirmed:** reviews are done. Set **Next step** to "Implement Section 1". The chain then stops for the browser chain (see above) unless that has finished.
5. Round cap: if round 3 still has a confirmed blocker or major, stop the chain and notify the user.

## Implementation steps ("Implement Section K", K = 1..12)

gpt-6.1-sol implements. This Opus session briefs it, checks its work, and owns the gate.

1. Check that the agent-browser chain is finished. If it isn't, stop and notify.
2. Record the base: `git rev-parse HEAD`. Section 1 also writes it into `handoff.md` as the final-review base.
3. Brief Sol with a pointer to the section, not a rewrite of it. The plan is already reviewed, so don't have the brief reviewed. Write the brief to `reviews/impl-K-brief.md`:

   ```
   Implement docs/superpowers/plans/2026-10-30-t3code-adoptions/<KK>-<name>.md in this repository, step by step, exactly as written.
   Read first: the plan index docs/superpowers/plans/2026-10-30-t3code-adoptions.md (Global constraints), design.md and handoff.md in the same folder (Facts, Deviations), and the section file.
   Rules:
   - Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
   - Follow the TDD order: write the test, see it fail, implement, see it pass.
   - Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
   - Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
   - Don't touch files the section doesn't list, except to fix a compile error the section causes.
   Final message: the commits made, the commands run with pass/fail, and any deviations.
   ```

   Run it with `codex exec -m gpt-6.1-sol`, workspace-write sandboxing and the brief on stdin, in the background (read the `codex-review` skill for the flags), and wait for it.
4. Check Sol's work yourself:
   - read the diff;
   - re-run typecheck, the section's tests and the package suite;
   - check the global constraints.
5. Review: `codex exec review --base <base> -m gpt-6.1-sol -c sandbox_mode=read-only`, saved to `reviews/impl-K.md`.
6. Triage it in `reviews/impl-K-triage.md`. Fix the confirmed findings yourself or with a short follow-up brief to Sol, and commit.
7. Update `handoff.md` and set **Next step** to the next section in the index's order (1, 2, 6, 3, 4, 5, 7, 8, 9, 10, 11, 12), or to "Section 13" after 12.

## Section 13

This session runs it itself, following `13-verify.md`. The `codex-computer-use` skill may be used for UI checks. The final review is part of it. When done, set **Next step** to "None: complete, ready for the user's review and push", then stop the chain and notify.
