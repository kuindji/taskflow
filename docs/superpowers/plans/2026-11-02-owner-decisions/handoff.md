# Handoff

Next: step R (plan review, round 3). Round 2 found 6 material issues; 5
verified and folded (S5 drain in-flight work before the move + no split data
on a failed move; S7 drop quoting per recorded shell; S9 file-store helpers
carry hash/result + recursive ancestor events). The 6th (S6: change the
discovery listener) was rejected: the listener switches a row's address in
place once the old one is quiet, so the registry change suffices; S6 wording
corrected. Round 3 should re-check only those round-2 folds (S5, S6, S7, S9).

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.

## Owner checks

(none yet)
