# Adoptions from t3code: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take what is worth taking from t3code (MIT): close the unauthenticated backend API, and fix the correctness and robustness gaps that comparing the two codebases exposed in terminals, scheduling, git, remote connections, agent discovery, the desktop updater, editor discovery and pull requests.

**Architecture:** No t3code architecture comes in. Each fix is reimplemented in Taskflow's own idiom (Bun, no Effect). Small pure pieces may be copied with attribution. All decisions live in `2026-10-30-t3code-adoptions/design.md`. Read it before any section.

**Tech Stack:** Bun, TypeScript, Electron 33, React 19 + zustand, xterm.js, OpenTUI, POSIX sh, bun:test.

**Starts after the agent-browser chain finishes** (`2026-10-30-agent-browser/handoff.md` says "None: complete"). Sections 1, 2, 4 and 5 change code the browser work adds (`/api/browser/*`, `/cdp/*`, Electron main's backend link). Two chains in one working tree would corrupt each other's commits, test runs and review diffs.

## How this plan is laid out

Each section is one file in `2026-10-30-t3code-adoptions/`, written to be implemented in a fresh session.
1. Before a section, read `handoff.md` (status and facts carried between sections), `design.md`, then the section file.
2. After a section, update the handoff.

The chain protocol is in `2026-10-30-t3code-adoptions/chain.md`. The research behind every decision is in `reviews/research-*.md`.

| # | Section | File | Depends on |
|---|---|---|---|
| 1 | Auth core: token, checks in report-only mode, handshake file, session env | `01-auth-core.md` | — |
| 2 | Auth, local clients: Electron main and renderer, dev UI, TUI local, both CLIs | `02-auth-local-clients.md` | 1 |
| 3 | Remote connectivity: no SSH multiplexing, desktop auto-reconnect, stale port refresh | `03-remote-connectivity.md` | 6 |
| 4 | Auth, remote clients: token over ssh, `4401` refresh, `--token`, manual entry | `04-auth-remote-clients.md` | 2, 3 |
| 5 | Auth, browser endpoints, then enforcement on | `05-auth-browser-enforce.md` | 4 |
| 6 | Terminal: no replies during replay, resync after dropped output and on reconnect | `06-terminal.md` | — (runs before 3) |
| 7 | Scheduler: admission, run-once catch-up, stable `nextRunAt` | `07-scheduler.md` | — |
| 8 | Git: literal pathspecs, worktree removal, output and preview limits | `08-git-safety.md` | — |
| 9 | Agent discovery: Codex models per account, Pi thinking levels | `09-agent-discovery.md` | — |
| 10 | Desktop updater state machine | `10-desktop-updater.md` | — |
| 11 | Editor discovery resolver | `11-editor-discovery.md` | — |
| 12 | GitLab merge requests | `12-gitlab.md` | — |
| 13 | Manual verification, final review | `13-verify.md` | all |

**Order: 1, 2, 6, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13.** Security first. Section 6 runs before 3, because 6 adds the web terminal's resync on reconnect, which 3's auto-reconnect relies on. Section 3 comes before 4, because 4's token refresh hooks into 3's reconnect loop. Sections 7–12 are independent of each other and of the auth work.

## Global constraints (every section)

- `bun`, never `npm` or `yarn`. No `as any`. No new exports unless something imports them. No `eslint-disable`. Reuse existing types and helpers before adding new ones.
- No `mock.module` in new tests. Inject dependencies instead (memory: `bun test` `mock.module` gotchas). Judge UI tests file by file.
- Never run `bun run format`, which rewrites the whole repo. Format changed files with `bunx prettier --write <files>`.
- Commit at each section's commit step, with the section's message and no `Co-Authored-By` or other trailers. Never push. Never create branches or worktrees.
- Copied t3code code carries the attribution comment from `design.md`.
- Exact strings (errors, close codes, env names, file names) are as `design.md` and the sections state them.

## Plan review log

- **Round 1** (2026-10-30, gpt-6.1-sol, `reviews/round-1.md`, triage `reviews/round-1-triage.md`): 12 findings, all confirmed (the blocker downgraded to minor), plus 4 of the session's own. 5 majors folded in: desktop live-`4401` recovery goes through `rehandshake` (S4); the TUI refresh gate re-arms only after `SYSTEM_INFO` (S4); `no-backend` keeps retrying (S4, design §2); a parser-timeout snapshot answers `null` (S6, design §3); Pi launch discovery has a 10 s budget (S9). Minors: handshake file via `0600` temp + rename (S1), subprotocol answer only when `taskflow` offered (S1, design §1), `ssh -G` output (S3, S13), Windows editor candidates (S11), CDP 401 vs 404 (S5, S13), full t3code SHA (design), `buildRemoteReadArgs(record, fileName)` (S3/S4), token in Settings → General and editable (S4), S6 wording.
- **Round 2** (2026-10-30, gpt-6.1-sol, `reviews/round-2.md`, triage `reviews/round-2-triage.md`): round-1 fixes hold. 7 findings, all confirmed (one major downgraded). 2 majors folded in: a primary remote gets primary back after any drop-and-reattach (S3 Task 3.3, test in S4); the async snapshot's callers, the HTTP route included, are named in S6 Task 6.1. Minors: a token save on an unauthorized machine retries it (S4, S13), `backends.json` temp file is unique and `wx` (S4), the 10 s Pi budget is asserted (S9), the `tf_curl` source check ignores comments (S2), S13's wrong-token check is split by whether ssh can read the token.
- **Round 3** (2026-10-30, gpt-6.1-sol, `reviews/round-3.md`, triage `reviews/round-3-triage.md`): round-2 fixes hold. 4 findings, all confirmed, both majors downgraded to minor, plus 1 of the session's own. Folded in: the dev renderer publishes backend-ready on socket reconnect (S6 Task 6.3); the connection overlay shows a failed primary remote's message and `Return to local` (S4 Task 4.2, S13); the `does not claim a live batch` snapshot test is replaced, not just awaited (S6 Task 6.1); S13 checks no longer rely on rejection logs the enforced backend doesn't write; one exact string for the CDP endpoint doc line (S5). No blocker or major: plan reviews are done.
