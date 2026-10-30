# Chain protocol: agent-drivable internal browser

This work runs as a chain of fresh Claude sessions, one step per session, so each keeps a small context. Every session follows this file.

## Every session

1. Read `handoff.md` (status and the **Next step** line), then the plan index `../2026-10-30-agent-browser.md`. Read only the files your step needs.
2. Do exactly the one step named under **Next step**. Don't start the following one.
3. Before handing off:
   - commit your work (no `Co-Authored-By` trailer);
   - update `handoff.md`: the status row, facts the next step needs, and the new **Next step** line;
   - commit `handoff.md`;
   - `taskflow-cli log info "<one line>"`, plus `taskflow-cli log commit "<msg>" --hash <hash>` for each commit, when running inside a task.
4. Start the next session, then close this one:

```bash
taskflow-cli agent run claude --model opus --effort high --permission-mode bypassPermissions \
  --label "Agent browser · <next step short name>" \
  --prompt "Continue the agent-drivable internal browser work. Follow docs/superpowers/plans/2026-10-30-agent-browser/chain.md exactly: read handoff.md and do the step named under Next step."
taskflow-cli session close
```

Stop the chain (don't start a next session) and run `taskflow-cli notify "Agent browser: <why>"` instead when:
- a step is blocked on a decision only the user can make;
- the Section 1 gate fails;
- tests or typecheck fail in a way the step can't fix without changing the design;
- the review loop hits its round cap (below);
- the last step is done.

Write the reason under **Next step** in `handoff.md` before notifying.

Don't push. The user pushes after the final review.

## Review steps ("Plan review round N")

1. **Round 1 only:** first run the review.
   - Read the `codex-review` skill.
   - Run `codex exec -m gpt-6.1-sol -s read-only` with the prompt on stdin, in the background, and wait for it.
   - Brief: review the spec and the plan (index + sections 01–08) against the real code; find wrong file or line claims, interface mismatches between sections, missing spec requirements, unsafe CDP filter rules, and Electron API assumptions that won't hold on Electron 33.
   - Save the output to `reviews/round-1.md`.
2. Verify every finding against the real code yourself. Codex's report is evidence, not authority. For each finding, record in `reviews/round-N-triage.md` one line: `confirmed` / `rejected`, plus why.
3. Fold confirmed findings into the plan section files and the spec's "Amendments" section. Add a line to "Plan review log" in the plan index.
4. Decide:
   - **Any confirmed blocker or major:** run round N+1 the same way. Brief it to check that round N's fixes hold and to look for new problems. Save its output to `reviews/round-(N+1).md`. Then set **Next step** to "Plan review round N+1".
   - **Only minors or nothing confirmed:** reviews are done. Set **Next step** to "Implement Section 1".
5. Round cap: if round 4 still has a confirmed blocker or major, stop the chain and notify the user.

## Section 1 ("Implement Section 1": the spike)

This session does the spike itself. Don't delegate it; the judgment calls are the point. Follow `01-spike.md`, record the facts in `handoff.md`, then apply the gate:
- **Pass:** set **Next step** to "Implement Section 2".
- **Fail:** stop the chain and notify.

If the spike changes a cross-section interface, update the plan index and the affected section files in the same session, and log it under "Plan review log" as "Spike amendments".

## Implementation steps ("Implement Section K", K = 2..7)

gpt-6.1-sol implements. This Opus session briefs it, checks its work, and owns the gate.

1. Record the base: `git rev-parse HEAD`. Section 2 also writes it into `handoff.md` as the final-review base.
2. Brief Sol with a pointer to the section, not a rewrite of it. The plan is already reviewed, so don't have the brief reviewed. Write the brief to `reviews/impl-K-brief.md`:

   ```
   Implement docs/superpowers/plans/2026-10-30-agent-browser/0K-<name>.md in this repository, step by step, exactly as written.
   Read first: the plan index docs/superpowers/plans/2026-10-30-agent-browser.md (Cross-section interfaces, Global Constraints), handoff.md in the same folder (Facts, Deviations), and the section file.
   Rules:
   - Make no design decisions. If a step is wrong against the real code, make the smallest fix that keeps the step's intent, and list it under "Deviations" in your final message. If you can't, stop and report why.
   - Follow the TDD order: write the test, see it fail, implement, see it pass.
   - Commit at each Commit step with the plan's message. No Co-Authored-By or other trailers. Never push. Never create branches or worktrees.
   - Never run `bun run format`. Format only the files you changed (`bunx prettier --write <files>`).
   - Don't touch files the section doesn't list, except to fix a compile error the section causes.
   Final message: the commits made, the commands run with pass/fail, and any deviations.
   ```

   Run it: `codex exec -m gpt-6.1-sol` with workspace-write sandboxing (read the `codex-review` skill for the flags), with the brief on stdin, in the background. Wait for it.
3. Check Sol's work yourself:
   - read the diff;
   - re-run typecheck, the section's tests and the package suite;
   - check the Global Constraints (no `as any`, no needless exports, no eslint-disable, no `mock.module` in new tests, exact strings).
4. Review: `codex exec review --base <base> -m gpt-6.1-sol -c sandbox_mode=read-only`, saved to `reviews/impl-K.md`.
5. Triage it in `reviews/impl-K-triage.md`. Fix the confirmed findings yourself or with a short follow-up brief to Sol, and commit.
6. Update `handoff.md`, then set **Next step**:
   - the order is 2, 3, 4, 5, 7, 6;
   - after 6: "Section 8".

## Section 8

This session runs it itself, following `08-verify.md`. The `codex-computer-use` skill may be used for UI checks. The final review is part of it. When done, set **Next step** to "None: complete, ready for the user's review and push", then stop the chain and notify.
