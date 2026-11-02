# One session in the owner-decisions chain

Index and status table: [../2026-11-02-owner-decisions.md](../2026-11-02-owner-decisions.md).
State between sessions: [handoff.md](handoff.md). Read both, then only the
section file for your step.

## 0. Start

`git pull --ff-only`. Take the first step in the index table whose status is
`todo`. Read `handoff.md` for notes left by earlier sessions.

## 1a. Step R — plan review

Have Codex review the whole plan (index + every section file) against the
code. Use the `codex-review` skill and read it before composing the command:
`codex exec -m gpt-6.1-sol -s read-only -C "$PWD" -o <scratchpad>/review.md -`
with the prompt on stdin, run in the background, wait for the notification.
Ask it to check each section for wrong file pointers, missed callers or
consumers, a decision that the described approach would not actually meet,
and missing tests. The decisions themselves are the owner's and are not up
for review.

Verify every finding yourself against the code. Fold confirmed ones into the
section files (keep them short). If Codex found anything material, run one
more review round in a fresh session (leave R as `todo`, note "round 2" in
the handoff). Otherwise mark R `done`. Commit `docs(plan): owner decisions
review round <n>` and push.

## 1b. Steps S1–S9 — implement one section

Follow `CLAUDE.md`: bun only, no `as any`, no needless exports, reuse
existing types and helpers, no eslint disables. Implement only what the
section says. If the code contradicts the section in a way that changes the
decision, stop, write it in `handoff.md`, mark the step `blocked`, and do not
chain on. Ask the owner instead.

Tests: a regression test for each behaviour change where a test can express
it. No source-inspection tests.

Gates: root `bun run typecheck` and `bun run lint`, then the tests of every
touched package (`bun test packages/<pkg>` or `bun test electron`, run from
the repo root, in the background). UI component tests leak `mock.module`
across files (memory `project_bun_test_mock_module`): judge a UI failure by
rerunning that file alone from the repo root. Do not run `bun run format`;
run `bunx prettier --write <files>` on files you touched.

Commit (stage by explicit path, `fix(<pkg>): …` or `feat(<pkg>): …`), then
have Codex review that commit: `codex exec review --commit <sha> -m
gpt-6.1-sol -c sandbox_mode=read-only` (read the `codex-review` skill first;
`exec review` takes no prompt and no `-s`). Verify each finding, fix the
confirmed ones in a follow-up commit, rerun the gates. One review round per
section unless the fixes were substantial.

Push. No co-author or session trailer lines. Non-fast-forward:
`git fetch origin && git rebase origin/main`, rerun gates, push.

## 2. Record

Set the step's status in the index (`done (<sha>)`). In `handoff.md`, replace
the "Next" line and add at most a few lines under "Notes" that a later
section needs (a changed helper, a gotcha). Drop notes no later step needs.
In the bughunt index, mark the matching decision line "implemented
(<sha>)". Commit with the code or as `docs(plan): …`, push.

Manual checks the owner must do (desktop UI behaviour you could not drive)
go under "Owner checks" in `handoff.md`.

## 3. Chain on

When every step is `done`, stop: tell the owner, summarise "Owner checks",
and do not start another session. Otherwise:

```sh
taskflow-cli agent run claude --label "Owner decisions <next step>" --prompt "Owner-decisions chain: follow docs/superpowers/plans/2026-11-02-owner-decisions/chain.md for the next step. Chain on as it says."
```

It must print `{"sessionId":…}`; no output means the launch failed: retry
and confirm with `taskflow-cli session status <id>`. Then
`taskflow-cli session close`.

Stop instead of chaining when a gate fails and you cannot fix it, Codex
fails twice, or a step is `blocked`. Say why in `handoff.md`.
