# Handoff

Next: step R (plan review, round 2). Round 1 (Codex gpt-6.1-sol) found 16
material issues; all verified and folded into S1, S3–S9 (S2 had none). Round 2
should re-check the sections, especially the new parts: S3 inherited-vs-chosen
fields in `AgentOptionsPanel`, S5 migration gate and restart choice, S6
IP-literal rule and (uid, address) pair detection, S9 typed conflict result
and per-path write lock.

## Notes

- UI tests must run from the repo root (`bunfig.toml` preload provides the
  DOM); `cd packages/ui && bun test` fails with `window is not defined`.

## Owner checks

(none yet)
