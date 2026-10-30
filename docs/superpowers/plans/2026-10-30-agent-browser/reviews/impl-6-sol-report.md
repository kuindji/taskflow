Stopped at Step 7. No commits made; nothing pushed.

Validation:
- New tests, run individually: PASS, 29 tests.
- Full UI suite, run file by file: 73/74 files pass. Two assertions fail in `useRunMenu.routing.test.tsx` because they count the new browser bootstrap request.
- Shared suite: PASS, 217 tests.
- Typecheck: PASS with installed TypeScript added to `PATH`; initial invocation failed with temp-directory `EPERM`.
- Changed-file ESLint, Prettier check, and `git diff --check`: PASS.
- Socket integration check: PASS.

Deviations:
- Moved the UA helper to shared; Electron reexports it.
- Monaco inherits overlay registration through `DialogContent`, avoiding duplicate registration.
- Added bootstrap-response validation after reproducing an invalid-response failure.

The pending scope exception is to exclude browser bootstrap traffic from the routing test’s assertions. Your explicit file restriction prevents that edit without approval, so Step 8 remains pending.