Changes required: a reproduced compatibility regression crashes Codex settings with an older, protocol-compatible backend. The focused discovery/UI tests and backend/UI typechecks passed.

Review comment:

- [P2] Handle model responses that omit account diagnostics — /Users/kuindji/Projects/taskflow/packages/ui/src/components/settings/sections/AgentAccountsSection.tsx:47-49
  When an older remote backend is selected as primary, `codex:models` returns `{ models }` without `account`. Both versions advertise protocol version 2, so the handshake accepts this combination. Storing `undefined` here makes the next render throw at `status.state`, crashing the UI when Codex settings opens. Treat absent account diagnostics as `{ state: "unknown" }` and cover the legacy response in a component test.
