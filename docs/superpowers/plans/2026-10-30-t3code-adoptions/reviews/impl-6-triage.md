# Section 6 review triage

Review: `impl-6.md` (gpt-6.1-sol, `codex exec review --base 347281c8`). Sol's report: `impl-6-sol-report.md`.

## Codex findings

- **P2, preserve queued resync requests when replay fails** (`terminal-attachment.ts` `start`): confirmed. A `replace()` that throws (history still short of the gap) left the `do…while` before `followUp` was read, so a resync that arrived during the attach was lost and the terminal stayed buffering. Repro test `a resync requested during a failed replacement still runs` failed (2 snapshot requests, expected 3). Fixed in 6a3e31bd: a failure retries only when a follow-up was requested, so there is still no retry loop without a new trigger. The TUI is unaffected: its `attachOnce` returns, not throws, on an incomplete replacement.

## Own checks

- Web, incompatible non-null snapshot (old remote backend without `mouseEncoding`): the attachment rejects and doesn't fall back to history. The old web code fell back to history silently. The plan decided this (Task 6.2: "remains a compatibility error"), and `TerminalPane` swallows the error, so such a terminal stays blank. No change. Left for the user to judge in Section 13.
- `pending` grows while attaches keep failing and output keeps arriving. No change: history runs on the persistence queue and repairs any reachable backend; a disconnected backend sends no output.
- `WebSocketProvider.test.tsx` uses a stub Bun WebSocket server instead of a real backend. No change: it still drives the real `connection-registry` reconnect path.
- Suites outside the sandbox: typecheck pass; shared 224/0; backend 1160/0 (2 skip); TUI 464/0; every UI test file passes on its own; Prettier, ESLint and `git diff --check` are clean on the changed files.
