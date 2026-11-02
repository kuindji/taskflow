# Handoff

Next: step R (plan review, round 4). Round 3 re-checked the round-2 folds:
S6, S7, S9 clean; S5 had one material gap, folded: the pointer write is the
commit point of the move (roll back copies only before it; after it keep the
destination, keep the gate closed, restart; a failed source delete is
leftover cleanup). Round 4 should re-check only that S5 fold.

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.

## Owner checks

(none yet)
