# S7 — Windows paths in terminal links (A13 R3-3)

Decision: support Windows paths in terminal file links and drop paths, keyed
to the session's backend OS (not the UI's OS).

Today `packages/ui/src/components/panes/terminal/terminal-link-provider.ts`
is POSIX-only: `normalizePath` (line 41) prefixes `/`, absolute means
`startsWith("/")` (line 54), containment is `cwd + "/"` (line 64). A Windows
session in `C:\repo` gets no links. Drop paths (grep the terminal drop
handler in `TerminalPane.tsx` / `terminal-lifecycle.ts`) assume POSIX too.

Work:
- Get the backend OS to the pane. Discovery's `DiscoveredBackend.os` does
  not cover the local or manually added machines, and the handshake does not
  carry an OS: `SystemInfo` (`shared/src/types/system.ts:15`), the
  `SYSTEM_INFO` handler (`backend/src/handlers/system.ts:19`) and
  `MachineState` (`ui/src/stores/backend-store.ts:43`) all lack it. Add
  `os` (Node `process.platform`) to `SystemInfo`, keep it on `MachineState`,
  read it by the session's backend id. Absent (older backend) → POSIX.
- Windows flavour: drive-letter absolute paths (`C:\x`, `C:/x`), UNC only if
  trivial, both separators in relative paths (`src\app.ts`), `..`
  normalisation, case-insensitive containment against cwd, `file:line:col`
  suffixes as on POSIX. Paths sent to the backend (open file) use the form
  the backend expects.
- POSIX behaviour unchanged. Keep one provider with a path-flavour helper;
  no copy of the provider.
- Drop paths: today `shellQuote` (`terminal/terminal-utils.ts:17`) applies
  POSIX quoting to every session, agents included. The pane does not know a
  shell session's shell: `SessionRef` (`shared/src/types/task.ts:7`) has no
  field for it, though `createSession` has the shell path
  (`session-lifecycle.ts:539`) and Windows offers pwsh, powershell, cmd and
  bash (`shell-detector.ts:97`). Record the shell name on shell
  `SessionRef`s at creation and pass it to the pane. Quoting dialects:
  POSIX (POSIX backends as today, bash on Windows), PowerShell (single
  quotes, `'` doubled), cmd (double quotes; Windows names cannot contain
  `"`). Agent sessions and shell refs without the field on a Windows backend
  use double quotes. The URI-list branch
  (`TerminalPane.tsx:490`) uses `new URL(uri).pathname`, which turns
  `file:///C:/repo/a.ts` into `/C:/repo/a.ts`; convert file URIs per flavour
  before making the path relative and quoting it.

Tests: table tests for the provider in both flavours (existing
`terminal-link-provider.test.ts`, `terminal-links.test.ts`); drop-path
quoting for cmd, PowerShell and an agent session on Windows, with spaces and
apostrophes, including a drive-letter file URI; a
Windows backend attached from a macOS UI gets Windows links.
