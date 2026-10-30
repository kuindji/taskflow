Changes required: the resolved-command change introduces a reproduced regression in remote-connected TUI editing. The focused resolver, detector, and TUI tests and backend typecheck pass, but do not cover this cross-machine path mismatch.

Review comment:

- [P2] Resolve TUI editors on the machine that launches them — /Users/kuindji/Projects/taskflow/packages/backend/src/services/editor-detector.ts:43-45
  When the TUI connects to a remote backend with a different editor installation path, returning that backend's absolute command breaks local record editing. `SettingsStore.terminalEditor()` forwards this command to `external-editor.ts`, which spawns it locally. Reproducing a Linux backend reporting `/usr/bin/nvim` on this Mac produces `ENOENT`, although the previous `nvim` command resolves to `/opt/homebrew/bin/nvim`. Update the TUI consumer to resolve its editor locally rather than executing the remote absolute path.
