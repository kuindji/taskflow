# Section 1 review triage (impl-1-review.md)

- [P2] Protected root/subtree signalled (`process-stopper.ts:262-264`): **confirmed**. `collectTree` walked the backend's descendants (PTY shells) and the filter dropped only `process.pid`, so a record naming the backend's PID, or an ancestor of it, signalled every session. Fixed test-first in `bbf73d40`: the root guard fails `operation not permitted` for `pid <= 0` or `process.pid`, and `collectTree` prunes those subtrees. Spec Amendment 12.
