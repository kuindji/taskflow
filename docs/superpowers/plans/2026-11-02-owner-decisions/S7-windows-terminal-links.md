# S7 — Windows paths in terminal links (A13 R3-3)

Decision: support Windows paths in terminal file links and drop paths, keyed
to the session's backend OS (not the UI's OS).

Today `packages/ui/src/components/panes/terminal/terminal-link-provider.ts`
is POSIX-only: `normalizePath` (line 41) prefixes `/`, absolute means
`startsWith("/")` (line 54), containment is `cwd + "/"` (line 64). A Windows
session in `C:\repo` gets no links. Drop paths (grep the terminal drop
handler in `TerminalPane.tsx` / `terminal-lifecycle.ts`) assume POSIX too.

Work:
- Get the backend OS to the pane: `DiscoveredBackend.os` exists
  (`packages/shared/src/types/backend.ts:10`); check what the connected
  backend reports for itself (local backend included) and use that, keyed by
  the session's backend id.
- Windows flavour: drive-letter absolute paths (`C:\x`, `C:/x`), UNC only if
  trivial, both separators in relative paths (`src\app.ts`), `..`
  normalisation, case-insensitive containment against cwd, `file:line:col`
  suffixes as on POSIX. Paths sent to the backend (open file) use the form
  the backend expects.
- POSIX behaviour unchanged. Keep one provider with a path-flavour helper;
  no copy of the provider.
- Drop paths: quote/escape for the session's shell on Windows the way the
  POSIX branch does for POSIX shells.

Tests: table tests for the provider in both flavours (existing
`terminal-link-provider.test.ts`, `terminal-links.test.ts`); drop-path
quoting for Windows.
