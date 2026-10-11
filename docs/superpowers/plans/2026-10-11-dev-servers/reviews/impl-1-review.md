The backend self-protection can still terminate unrelated active sessions. Backend typechecking and 23 mocked process-stopper tests passed; filesystem-writing tests were blocked by the read-only environment.

Review comment:

- [P2] Reject a protected root before signalling its descendants — /Users/kuindji/Projects/taskflow/packages/backend/src/services/process-stopper.ts:262-264
  If a registration uses the backend's own PID, this filter removes only the backend after `collectTree` has included its descendants. Those descendants include the PTY shells created by `PtyManager.spawn`, so Stop terminates unrelated agent sessions and reports `stopped` while the registered process remains alive. An injected-process probe reproduced this behavior. Reject a protected root before collecting its tree, and exclude protected subtrees rather than filtering individual PIDs after traversal.
