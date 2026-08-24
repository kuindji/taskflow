# Plan-review repros — remote projects

Evidence for the review of
`docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md`.

Each test embeds the plan's own code **verbatim as it stood before the
2026-08-24 revision**, with the source line noted above the block, and drives it
through the sequence the plan described. Every assertion states the *wrong*
behaviour that version produced — so these pass, and passing is the point.

They are evidence, not regression tests. The plan has since been revised against
all of them; delete each one when the task that fixes it lands.

| File | Findings |
|---|---|
| `plan-defects.test.ts` | local backend has no machine row; provisional-uid rekey closes its own socket; background launch dial leaves a machine attached with no socket; concurrent fetches let the staler answer win; a spoofed beacon keeps a machine unattachable |
| `backend-record-conflict.ts` | `BackendRecord` declared twice — `bunx tsc --noEmit --strict --skipLibCheck plan-review/backend-record-conflict.ts` |
| `registry-concurrency.test.ts` | registry mutators write back a stale snapshot: remove-during-attach resurrects, rename-during-attach is lost |
| `hard-switch-concurrency.test.ts` | two concurrent `workAs` calls detach each other's target |

Two more live next to the stores they exercise, because they run against the
real code rather than a transcript — `packages/ui/src/stores/wiki-backend-collision.repro.test.ts`
and `.../file-backend-collision.repro.test.ts`, plus
`packages/ui/src/lib/editor-uri-opener.repro.test.ts`. The wiki one must be run
on its own: bun's `mock.module` is global and other suite files mock the same
module path.
