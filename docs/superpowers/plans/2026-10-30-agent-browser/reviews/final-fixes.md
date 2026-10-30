**Changes required.** Two major findings; no blockers.

1. **Major — old-primary teardown deletes the newly restored master tabs.**  
   [session-subscriptions.ts:201](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/session-subscriptions.ts:201)

   During a hard switch, `runSwitch()` promotes the target before detaching the old primary. This callback adds the target’s cached master tabs, but `session-store` still records the old backend as `masterBackendId`. Resetting that backend then clears the entire master workspace.

   Reproduced with the real stores and a fake transport: promotion produced `["new-master"]`; old-backend reset removed it while the new backend’s cached list remained intact. The added test omits teardown.

   **Fix:** reconcile cached master tabs after teardown, or transfer workspace ownership before reconciliation so the old backend’s reset cannot remove them.

2. **Major — keep-awake leaves parked child pages throttled.**  
   [cdp-gateway.ts:260](/Users/kuindji/Projects/taskflow/packages/backend/src/services/cdp/cdp-gateway.ts:260)

   The helper attaches only to `upstreamInfo.targetId`. A Puppeteer connection through the parent endpoint can create or adopt child pages, but those pages receive no focus emulation. They therefore retain the rendering problem this fix addresses. Chromium applies this override to the attached page’s own WebContents. [Chromium implementation](https://chromium.googlesource.com/chromium/src/%2B/ce37893fc2edd6144ef3e346dc703a5a4f340006/content/browser/devtools/protocol/emulation_handler.cc)

   **Fix:** maintain keep-awake sessions for every allowed family page, including arriving children, and release them when the page or connection closes. This finding follows from the code and Chromium implementation; child-page frame rate was not measured live.

No additional material defects found in request-ID correlation, negative/context IDs, session checks, closing-set error handling, or capture rejection/timeouts.

Validation: **114 focused tests passed**, plus backend and UI typechecks. Filesystem-backed service tests and live Electron rendering were not run.