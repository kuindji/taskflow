# Section 13: Manual verification and final review

Run against the real desktop app built from `main`, on macOS. Run the auth items against a **packaged** build too (`bun run package`), because only the packaged renderer loads from `file://`. Write test clients and attacker pages in the scratchpad, not in the repo. Record pass/fail per item in `handoff.md` ("Section 13 checklist"). An item that can't run on this machine (Windows, a second machine, GitLab) is recorded as "not run: <why>", plus the unit tests that cover it.

## Checklist

### Auth (Sections 1, 2, 4, 5)

1. **Web pages are refused.**
   - Serve a page from `http://localhost:8765` (`python3 -m http.server`). From it, run `new WebSocket("ws://127.0.0.1:<port>")` and `fetch("http://127.0.0.1:<port>/api/sessions", { method: "POST", mode: "no-cors", headers: { "content-type": "text/plain" }, body: "{}" })`. Expected: the socket never opens, no session is created, and the backend log shows 403 for both.
   - Open the same page in a hosted browser tab: same result.
2. **No credential, wrong Host.**
   - `curl` without a token to `/api/settings` gives `401 {"error":"Unauthorized"}`.
   - A Bun `WebSocket` without a token is closed with `4401`.
   - `curl -H "Host: evil.example:<port>" .../` gives 403.
   - `GET /` without a token still answers `Taskflow backend`.
3. **Every client still works.** Each of these runs, and the backend log shows no auth rejection:
   - packaged app: terminals, a markdown image (raw URL token), an artifact download, tray state, notifications;
   - dev app;
   - plain-browser dev UI;
   - TUI local;
   - TUI `--connect 127.0.0.1:<port> --token <t>`, and the same with `TASKFLOW_TOKEN`;
   - `taskflow-cli` (sh) inside an agent session: `task`, `log info`, `browser open`;
   - the TS bin, run with `bun` and the same env;
   - a flow-run session and a scheduled session that call the CLI.
4. **Token file.** `api-token-<instanceId>` is mode `0600`. Delete it and restart: a new token is written, the local app reconnects, and an old CLI env gets 401.
5. **Remote** (needs a second machine reachable over SSH; otherwise "not run").
   - Adding the machine reads the token over ssh, and the connection works.
   - Rotate the remote token (delete its file, restart its backend): the client gets `4401`, re-reads the token once and reconnects.
   - Enter a wrong token by hand: the client shows `Remote backend rejected the access token`.
6. **Settings → General** (under "Discoverable on this network") shows the local token, and Copy puts it on the clipboard. Editing a machine's saved token reconnects it.
7. **CDP.**
   - Playwright `connectOverCDP` with the `endpoint` from `taskflow-cli browser open` works.
   - `<endpoint>/json/version` with one character of the key changed gives 401.
   - Tab A's key on tab B's path gives 401.
   - After an app restart, the endpoint path (key included) is unchanged.

### Remote connectivity (Section 3)

8. `ssh -G` with the argv Taskflow builds (take it from the debug log or a unit-test fixture) shows `controlmaster false` and `controlpersist no`, and no `controlpath` other than `none` (OpenSSH 10.5 omits the line), even with a `ControlMaster auto` block in a test `ssh_config`.
9. Desktop app attached to a remote (or to a second local backend through `ssh localhost`, if sshd is on):
   - `kill` the tunnel's ssh process: the backend shows reconnecting and comes back by itself;
   - sleep and wake the Mac: it reconnects at once after wake;
   - an open terminal resyncs from its snapshot, with no duplicated or replayed input.

### Terminal (Section 6)

10. In a shell session, run `printf '\033[6n'`, then force the history replay path (the section's notes say how). Remount the terminal: no `^[[<row>;<col>R` appears at the prompt.
11. Dropped output: run the section's slow-client test (`bun test` name in `06-terminal.md`). By hand, view a session from the TUI over a throttled tunnel, if one can be set up, while it prints 200 MB. Then compare its screen with the desktop's. Otherwise record "unit tests only".

### Scheduler (Section 7)

12. A schedule every 2 minutes: quit the app for 5 minutes, then start it. It runs **once**, and `nextRunAt` is in the future.
13. `taskflow-cli schedule trigger <id>` twice at once (`&`) starts one session.
14. Rename the schedule: `nextRunAt` is unchanged. Change its interval: `nextRunAt` moves.

### Git (Section 8)

15. Change both `app/[id]/page.tsx` and `app/i/page.tsx` in a test repo, then revert the first from the Changes pane. The second keeps its change.
16. A 6 MiB text file and a PNG show their placeholders in the file view, and Save is disabled for both.
17. Delete a worktree task: its worktree and branch are gone. Delete one whose worktree directory was removed by hand first: it's pruned, with no error. Windows junction removal is "not run" unless a Windows machine is available.

### Discovery, updater, editors, GitLab (Sections 9–12)

18. Settings: each Codex account shows its own model list and its sign-in status. A Pi model without extended thinking offers no `xhigh`.
19. Updater: run the reducer's unit tests. If a test feed exists, also: a failed install keeps "Restart to update" with Retry. Otherwise record "unit tests only".
20. With an editor installed as an app but with no CLI shim on `PATH`, it's detected and "Open in" launches it.
21. GitHub PR create and status still work on a GitHub repo. GitLab: on a GitLab remote with `glab` logged in, an MR can be created and its status shows. Otherwise "not run". With `gh` logged out, the PR status shows unavailable, not "no PR".

## Steps

- [ ] **Step 1:** Run the checklist. Fix defects in the owning section's files, with a unit test where one can catch the defect. Commit each fix as `fix(<area>): …`.
- [ ] **Step 2:** Final review: run `codex exec` with `-m gpt-6.1-sol -s read-only` (read the `codex-review` skill first) over `<base>..HEAD`, where `<base>` is the one Section 1 recorded in `handoff.md`. Brief it with `design.md` and the security goal: no unauthenticated path to sessions, PTY input, settings or files. Save the output to `reviews/final.md`. Triage it in `reviews/final-triage.md`, fix the confirmed findings, and record them.
- [ ] **Step 3:** Update `handoff.md` (checklist results, "Deviations from the design"). Commit `docs: t3code adoptions verification and close-out`.
