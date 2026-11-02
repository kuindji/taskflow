# Owner decisions from the bughunt (2026-11-02)

The 2026-10-31 bughunt left 11 product calls for the owner. All were decided
on 2026-11-02 (see "Owner decisions (2026-11-02)" in
[2026-10-31-bughunt.md](2026-10-31-bughunt.md)). This plan implements them,
one section per chained Taskflow session.

- How a session runs: [chain.md](2026-11-02-owner-decisions/chain.md)
- Current state and notes between sessions: [handoff.md](2026-11-02-owner-decisions/handoff.md)

All work happens on `main`. Already done before this plan: archive purging
removed (`ff11050c`), "Run agent with task description" removed (`eb271c3b`).

## Sections

Status values: `todo`, `done (<commit>)`, `blocked (see handoff)`.

| Step | Section | Finding | Status |
| --- | --- | --- | --- |
| R | Plan review (Codex gpt-6.1-sol), triage into the sections | — | done (5 rounds) |
| S1 | [Run now on disabled schedules; drop Terminal.app import](2026-11-02-owner-decisions/S1-schedule-run-now-and-terminal-app.md) | A05 R3-2, A08 R5-3 | done (1d642fad) |
| S2 | [`task create` subtask flags in both CLIs](2026-11-02-owner-decisions/S2-cli-task-create.md) | A01 R2-1 | done (15a4c104, ce77eadc) |
| S3 | ["Default" means the Settings value](2026-11-02-owner-decisions/S3-launch-option-defaults.md) | A16 R3-2 | done (f21c781d, 6efa2ec0, 686129b6, 1198926f) |
| S4 | [Read-only archived task view in the UI](2026-11-02-owner-decisions/S4-archived-task-view.md) | A15 R4-1 | done (901451c0, 277d6d61) |
| S5 | [Data folder change moves everything, then restarts](2026-11-02-owner-decisions/S5-data-folder-move.md) | A01 R1-2 | done (cd0841d6, b3d6dd75) |
| S6 | [Remote machine identity: new IP and taken port](2026-11-02-owner-decisions/S6-remote-identity.md) | A10 R1-2, A10 R2-2 | done (bf94a84c, ad56e7b5) |
| S7 | [Windows paths in terminal links](2026-11-02-owner-decisions/S7-windows-terminal-links.md) | A13 R3-3 | done (ec16911f, 469b04f1) |
| S8 | [Reference-counted file watches in the UI](2026-11-02-owner-decisions/S8-file-watch-refcount.md) | A20 R4-1 | todo |
| S9 | [Editor and checkbox writes that respect disk changes](2026-11-02-owner-decisions/S9-editor-disk-changes.md) | A18 R2-2, A20 R2-1 | todo |

S9 depends on S8 (reload needs `FILE_CHANGED` while the explorer is closed).
The others are independent; run them in table order.
