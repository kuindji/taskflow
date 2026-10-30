# Section 7 review triage

Review: `impl-7.md` (`codex exec review --base 3f66fd8a`, gpt-6.1-sol). One finding, reported twice.

- **P2, due checks await pending spawns** (`scheduler-service.ts` `scheduleNext`): confirmed. `scheduleNext` awaited `execute` through `spawnSession`, so `checkDue` handled overdue schedules one at a time and `init()` (`index.ts:576`) blocked remote-agent start and change tracking until every overdue spawn resolved. Fixed: the due path dispatches `execute` through `background()`. `execute` still admits synchronously. Test `a pending overdue spawn holds neither init nor other overdue schedules` (fails before the fix with a 5 s timeout).
- **Own, minor: `Failed to schedule: …` no longer stored**: confirmed. Sol dropped the old `lastError` write from the init loop without listing it as a deviation, so a stored invalid expression only logged, every 30 s. Fixed: `checkDue` writes `Failed to schedule: <message>` once and skips the log and write while `lastError` already says the same. Test `a scheduling failure is recorded once across ticks`.
