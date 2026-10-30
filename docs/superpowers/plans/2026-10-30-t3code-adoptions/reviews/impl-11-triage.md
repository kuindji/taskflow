# Section 11 review triage

Review: `impl-11.md` (`codex exec review --base 2d76afc6`, gpt-6.1-sol). The same P2 is printed twice.

- **P2, remote TUI runs the backend's absolute internal-editor path locally: confirmed, fixed in c01619e8.** `SettingsStore.terminalEditor()` (`packages/tui/src/settings/store.ts:120`) passes `EditorInfo.command` to `external-editor.ts`, which spawns it on the TUI's machine. A Linux backend reporting `/usr/bin/nvim` gives ENOENT on a Mac where bare `nvim` resolves. I found the same thing before the review came back. Fix: detection still uses the resolver to decide whether an internal editor is available, but internal editors keep their bare catalog command. That is today's behavior and matches "internal editors remain PATH-only". External editors get the resolved path. Regression test: `internal editors keep their bare command, line flags and extra args` (fails on 4b5da463).

Own checks:
- Gate suites: backend 1370/0, shared 261/0, `open-file-plan` 9/0, typecheck, eslint and prettier on the changed files all pass.
- Unrelated flake: `scheduler-service.test.ts` "startup runs an overdue cron once…" fails about 1 run in 8 or more with `JSON Parse error` in `drain()` → `store.getAll()`. `ScheduleStore` writes with plain `writeFile` (since 4990b531), so a read during a write sees a torn file. This predates Section 11 and is out of scope; it's recorded for Section 13.
- Real macOS detection: nvim/vim/nano/vi bare, Cursor from `~/.local/bin`, Zed from `/Applications/Zed.app/Contents/MacOS/cli` (no PATH shim, no probe), 158 ms.
