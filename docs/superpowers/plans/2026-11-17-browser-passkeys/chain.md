# Chain protocol: browser passkeys

This work runs as a chain of fresh Claude sessions, one step per session. Every session follows this file.

## Every session

1. Read `handoff.md` (status and **Next step**), then the plan index `../2026-11-17-browser-passkeys.md`. Read only the files your step needs.
2. Do exactly the one step named under **Next step**.
3. Before handing off:
   - commit your work (no `Co-Authored-By` trailer);
   - update `handoff.md` (status row, facts the next step needs, new **Next step**) and commit it;
   - `taskflow-cli log info "<one line>"`, plus `taskflow-cli log commit "<msg>" --hash <hash>` per commit, when inside a task.
4. Start the next session, then close this one:

```bash
taskflow-cli agent run claude --model opus --effort high --permission-mode bypassPermissions \
  --label "Passkeys · <next step short name>" \
  --prompt "Continue the browser passkeys work. Follow docs/superpowers/plans/2026-11-17-browser-passkeys/chain.md exactly: read handoff.md and do the step named under Next step."
taskflow-cli session close
```

Stop the chain (no next session) and run `taskflow-cli notify "Passkeys: <why>"` instead when:
- an owner-gated step is reached (see the plan index);
- the Section 1 gate fails;
- tests/typecheck fail in a way the step can't fix without changing the design;
- the review loop hits its cap;
- the last step is done.

Write the reason under **Next step** in `handoff.md` before notifying. Don't push.

## Codex commands (read `~/.claude/skills/codex-review/SKILL.md` first; always `-m gpt-6.1-sol`, default effort, run in background and wait)

- Prompted review (plans, focused reviews): `codex exec -m gpt-6.1-sol -s read-only -C "$PWD" -o <report> - < <prompt> > <log> 2>&1`
- Diff review: `codex exec review --base <sha> -m gpt-6.1-sol -c sandbox_mode=read-only` (no prompt, no `-s`; capture stdout to the report file).

## Plan review rounds ("Plan review round N")

1. Run a prompted review. Brief (save as `reviews/plan-round-N-prompt.md`): review the spec and the plan (index, chain, handoff, sections 01–04, `spike/webauthn-probe.ts`) against the real code in `electron/`; look for wrong file/line claims, wrong Electron 45 / electron-builder 26 assumptions (especially `app.configureWebAuthn`, the on-demand binary download from Electron 42, signing/entitlements, provisioning profiles), missing spec requirements, unsafe or irreversible steps not owner-gated. Round N>1: also check that round N−1's fixes hold. Report to `reviews/plan-round-N.md`.
2. Verify every finding against the code/docs yourself. One line each in `reviews/plan-round-N-triage.md`: `confirmed` / `rejected` + why.
3. Fold confirmed findings into the section files (and the spec if it changes the design). Add a line to "Plan review log" in the index.
4. Any confirmed blocker/major → **Next step** "Plan review round N+1". Otherwise → "Implement Section 1". Cap: if round 3 still has a confirmed blocker/major, stop and notify.

## Implementation steps ("Implement Section K")

The session implements the section itself (the code is small; the judgment is in the verification). Don't delegate to Sol.

1. Record the base: `git rev-parse HEAD` into `handoff.md` (Section 1 also writes it as the final-review base).
2. Follow the section file step by step.
3. Section 2 and 3 only: after the section's commits, run the diff review against the base, save to `reviews/impl-K.md`, triage in `reviews/impl-K-triage.md`, fix confirmed findings, commit.
4. Set **Next step** per the section's last step.
