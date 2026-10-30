The backend, shared, and UI typechecks pass, but a reproduced load/close race leaves a target mapping for a deleted tab and fails to close its pending host view. Filesystem-backed tests were not run in the read-only sandbox.

Review comment:

- [P2] Cancel pending loads when closing a tab — /Users/kuindji/Projects/taskflow/packages/backend/src/services/browser-tab-service.ts:168-170
  If a saved tab is closed while `ensureLoaded()` awaits the host, `closeFamily()` removes it without contacting the host because `loaded` is still false. When the pending ensure completes, these lines reinstall its target mapping and return success despite the tab having been deleted. A deferred-ensure probe reproduced `get("root") === null`, a target still mapped to `"root"`, and zero host close calls. Track pending loads or closing state so late completions close the host view and reject instead of returning a deleted tab's target.
