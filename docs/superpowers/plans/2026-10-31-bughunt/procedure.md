# One bughunt session

One session runs one round on one area. Index and status table:
[../2026-10-31-bughunt.md](../2026-10-31-bughunt.md).

## 1. Pick the area

`git pull --ff-only`, then take the first area in the status table that is
not `clear` or `parked`. Read only that area's file.

## 2. Run Astra

Fill [astra-prompt.md](astra-prompt.md) for the area (scope paths, the
area's "Already handled" list) into a scratchpad file and run from the repo
root, in the background, with no timeout (a real review takes a while):

```sh
codex exec -m gpt-6-astra -s read-only -C "$PWD" -o "$ART/report.md" - < "$ART/prompt.md" > "$ART/log" 2>&1
```

`$ART` is a folder in your scratchpad. Wait for the completion notification;
do not poll. An empty `report.md` with a non-zero exit is a failed run: read
`log`, retry once, then stop and tell the owner.

## 3. Verify every finding yourself

Astra's word is a lead, not a verdict. For each finding, read the code and
confirm the failure path. Prefer proving it with a failing test before
fixing. Verdicts:

- **confirmed**: real, reachable by a user of the shipped desktop app, TUI,
  `taskflow-cli` or an agent session driving the CLI.
- **rejected**: not reachable, already guarded, needs a hostile local user,
  a modified client, or a tool (git, ssh, an agent CLI) breaking its
  documented contract, or is purely hypothetical.
- **owner**: the code does what it says but the behaviour may be wrong; a
  product call. Do not fix; add it to "Waiting for the owner" in the index.

Drop style, naming, refactor and "missing test" remarks without logging them.

## 4. Fix confirmed bugs

Follow `CLAUDE.md` (bun only, no `as any`, no needless exports, reuse
existing types and helpers, no eslint disables). Each fix gets a regression
test where a test can express it; no source-inspection tests. Keep fixes
minimal; a fix that needs a design change becomes an `owner` item.

Gates: root `bun run typecheck` and `bun run lint`, then the tests of every
touched package (`bun test packages/<pkg>` or `bun test electron`), in the
background. UI component tests leak `mock.module` across files (memory
`project_bun_test_mock_module`): judge a UI failure by rerunning that file
alone, and only count failures your change caused (compare against
`git stash` if unsure). Do not run `bun run format` (memory
`feedback_scope_prettier_runs`); run `bunx prettier --write <files>` on the
files you touched.

## 5. Record, commit, push

In the area file, append a round entry: date, finding count, each finding as
`R<n>-<k>` with verdict, one line of reason, and the commit for confirmed
ones. Add rejected findings' one-line summaries to "Already handled" so the
next round does not raise them again. Update the area's status in the index:

- any confirmed finding → `round N`, the next session hunts the same area;
- none confirmed → `clear`;
- round 4 still finding only minor confirmed bugs → `clear` with a note,
  unless they lose data, corrupt stores, or kill sessions.

Stage files by explicit path, check `git diff --cached --stat`, commit
(`fix(<package>): …`; `docs(bughunt): <area> round <n>` for a clean round),
push. No co-author or session trailer lines. Non-fast-forward:
`git fetch origin && git rebase origin/main`, rerun the gates you ran, push.

## 6. Chain on

If the round was clean and the session still has room, it may start the next
area's round in the same session (back to step 2). Otherwise:

```sh
taskflow-cli agent run claude --label "Bughunt <area> round <n>" --prompt "<prompt>"
```

Prompt: "Bughunt cycle: follow
docs/superpowers/plans/2026-10-31-bughunt/procedure.md for the next round.
Chain on as it says." Nothing else; the docs carry the rest.
It must print `{"sessionId":…}`; no output means the launch failed — retry and
confirm with `taskflow-cli session status <id>` before closing. Then
`taskflow-cli session close`.

Stop instead of chaining when a gate fails and you cannot fix it, when Astra
fails twice, or when every area is `clear`/`parked`. Say why in the index.
