# Round 3 triage

All six round 2 fixes hold, per Codex's in-memory typecheck, eslint and runtime probes. I re-checked DS2-03 and DS2-04 with scratch tsc and eslint runs in round 2.

- **DS3-01 (minor): confirmed.** A request timeout only deletes the pending entry and rejects locally (`connection.ts:176-180`); no cancel goes to the backend. After `kill -CONT` the queued stop runs, kills the sleep and broadcasts its removal, so with the popover closed the button hides and the check can't be done. Fix: item 10 reopens while the backend is still stopped and checks that the row is present, Stop is enabled and no error shows; the backend resumes afterwards.

Only a minor was confirmed, so reviews are done. Next: Implement Section 1.
