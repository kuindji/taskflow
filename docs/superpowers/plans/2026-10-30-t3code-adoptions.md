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

(empty)
