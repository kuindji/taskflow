# Astra prompt template

Copy everything below the line into the round's `prompt.md` and fill the two
placeholders from the area file.

---

You are hunting bugs in one area of a TypeScript monorepo (Bun workspaces).
The product is Taskflow, a desktop app that organises AI coding agents: a
Bun backend (HTTP + WebSocket, JSON stores on disk, PTY sessions, git
worktrees, flows, schedules) serves an Electron + React UI, an OpenTUI
terminal client, and `taskflow-cli` (a POSIX shell script on macOS/Linux and
a compiled TS binary on Windows) that agents run inside their sessions. A UI
or TUI can attach to a remote backend over an SSH tunnel. Read `CLAUDE.md`
for repository rules.

Area scope (only report bugs whose root cause is in these paths; read
anything else you need for context):

{{SCOPE}}

Find concrete bugs: code that produces a wrong result, loses or corrupts
stored data (tasks, projects, flows, schedules, settings), kills or orphans
sessions and processes, hangs, crashes, leaks resources until the app
misbehaves, or leaves UI and backend state inconsistent, in a way a real user
(or an agent using `taskflow-cli`) can trigger. For every finding you must
give:

1. `file:line` of the root cause;
2. the trigger: concrete inputs, state, or a user action sequence;
3. what happens versus what should happen;
4. why existing guards and tests do not catch it (name what you checked).

Do not report:

- style, naming, refactors, missing tests, missing docs, performance without
  a user-visible effect;
- anything that needs a hostile local user, a modified client, or a tool
  (git, ssh, an agent CLI, the OS) breaking its documented contract;
- "could be a problem if" speculation you did not trace through the code.

You may run read-only commands (grep, reading tests, `git log`). Fewer real
findings beat many weak ones; an empty list is a valid answer.

Already handled in earlier rounds (do not report again):

{{ALREADY_HANDLED}}

Answer in Markdown: one `## F<n>: <title>` section per finding with the four
items above and a severity (`high`: data loss, store corruption, session or
process loss, crash on a common path; `medium`: wrong result or stuck state
with a workaround; `low`: rare edge). End with a one-line list of the files
you read.
