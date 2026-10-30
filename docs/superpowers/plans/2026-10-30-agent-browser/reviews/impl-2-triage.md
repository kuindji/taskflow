# Section 2 review triage

Review: `impl-2.md` (gpt-6.1-sol, `codex exec review --base 91a3e89c`). It printed one finding twice.

- [P2] A close during a pending `ensure` leaves a mapping for the deleted tab and never closes the host view: **confirmed**. `closeFamily` skips the host because `loaded` is still false, and `load` then sets `loaded` and the mapping on the detached record. This affects `open`, `openChild` and `ensureLoaded`. Fixed in `load`: if the record is no longer in the registry after `ensure` returns, it closes the host view (fire and forget) and throws `BrowserTabNotFoundError`. Test: `close during a pending ensure closes the late view and rejects the load`.

Own checks (not from the review), no change:
- `closeForOwner` stops at the first family whose store write fails. That matches the plan's wording (`close` for every root); store failures are rare and the rest get closed on the next archive or restart via `init`. Minor, left.
- Sol's 19 backend failures (process-stopper, watcher) came from its sandbox; the full suite passes outside it (969/969).
