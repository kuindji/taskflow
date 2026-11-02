# Handoff

Next: step R (plan review, round 5). Round 4 re-checked the S5 commit-point
fold and found two gaps, folded: gate release only before the pointer
commit (item 2 said "any failure"); the pointer write must be atomic and a
failed reset (pointer removal) must throw and roll back. Also folded: adopt
mode needs the same gate and restart. Round 5 should re-check only those S5
folds.

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.

## Owner checks

(none yet)
