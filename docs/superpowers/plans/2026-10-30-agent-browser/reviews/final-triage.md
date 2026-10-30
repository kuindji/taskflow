# Final review triage

Codex review (`final.md`, range `91a3e89c..4a0807fe`): four majors, all confirmed and fixed.

1. confirmed (major): CDP request-id reuse let a `Target.getTargets` reply skip filtering. Reproduced in a filter test. A duplicate-id check (c7043064) wasn't enough: the automated security review then showed an empty `sessionId` does the same, because Chromium's reply never matched the recorded key. Fixed in 27e347a6: the filter gives every forwarded request its own upstream id and maps replies back, drops replies it didn't ask for, and refuses any `sessionId` it hasn't allowed, empty included.
2. confirmed (major): a child opened or adopted while its family was closing outlived the parent (`closeFamily` snapshots, removes the root last). Reproduced in a service test. Fixed in db29fb74: a `closing` set refuses `openChild`, `child-opened` adoption and heartbeat re-adoption under a closing family.
3. confirmed (major): a capture that never settled stalled every later freeze, because each caller's deadline started after the previous capture. Fixed in 89bcdbe3: the serial queue moved to `capture-queue.ts` with tests, and each deadline starts at enqueue.
4. confirmed (major): master browser tabs listed before their backend became primary were never placed. Reproduced in a store test. Fixed in 28c66b6f: a primary change re-syncs the new primary's cached list without changing the active tab.

Found by the Section 8 checklist (see `handoff.md`, "Section 8 checklist"):
- confirmed (major): a parked tab rendered at about 1 Hz for a client that doesn't turn on focus emulation itself (Puppeteer: rAF ~900 ms, screenshot ~3 s). A first fix in Electron (c992c4ba, holding `webContents.debugger` on each view) stopped other CDP clients from getting the page's subframe events, so Playwright never saw iframes created after it connected. Reverted in a391bbe2. Fixed in 5d4b4e3d: the gateway holds focus emulation on its own upstream session while an agent is connected.
- confirmed (item 15): the rewritten Chrome UA failed Cloudflare's managed challenge and Google sign-in; the native UA passed both. Fixed in a1295f7d (Section 5's planned fallback).

Codex review of the fixes (`final-fixes.md`, range `4a0807fe..28c66b6f`): two majors, both confirmed and fixed.
- confirmed (major): a machine switch promotes the target before detaching the old primary, and the old primary's reset dropped the whole master workspace, including the master browser tabs just placed for the new primary. Reproduced in a store test. Fixed in c7176fee: a reset keeps browser tabs when it drops a workspace; the browser-tab reset removes the old machine's own.
- confirmed (major): the keep-awake session covered only the root page, so parked popups and agent pages stayed at about 1 Hz. Fixed in 54e5505a: it discovers targets and holds focus emulation on every page of the tab's family. Live: a parked popup under Puppeteer went to rAF ~1 ms, screenshot ~95 ms.

Codex review of those two fixes (`final-fixes-2.md`, range `28c66b6f..54e5505a`): one minor, confirmed and fixed; nothing else found.
- confirmed (minor): a page that registered more than 2 s late (after a host-event retry) never got keep-awake. Fixed in bd456089: an unresolved page is forgotten and reconsidered on `Target.targetInfoChanged`.
