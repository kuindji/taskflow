# Section 6 review triage

Review: `impl-6.md` (gpt-6.1-sol, `codex exec review --commit 30f1c8da`). Fix: c3c85776.

- [P2] `ConnectionOverlay` (`App.tsx`) isn't registered, so a hosted view stays above the disconnect blocker: **confirmed**. It's the only hand-rolled full-screen overlay outside `components/ui/` (grep for `fixed inset-0`/`createPortal`). Fixed: it registers with `useRegisterOverlay(ref, !connected)`.

Own findings (from reading Sol's uncommitted work, all fixed before 30f1c8da):
- Sol stopped at Step 7: `useRunMenu.routing.test.tsx` saw an extra `browser:tabs:list` at a backend the test expects to stay silent. Cause: Sol fetched the list from `session-subscriptions` on every attach (with a `queueMicrotask` workaround for an import cycle and a separate primary listener for web dev). **Confirmed** as misplaced: dev servers bootstrap in `backendStore.bootstrapBackend`, which also runs for the primary in web dev (`useSidebarData`). Moved the fetch there; the routing test passes unchanged.
- `HostedBrowserPane`'s show/hide effect depended on `tab.url`, so every navigation broadcast ran `hide` then `show` (flicker, racing IPC): **confirmed**. Fixed: url read through a ref. Test `a url change from navigation keeps the view shown` fails before, passes after.
- New Tab and terminal links each built the scope and host check inline: **confirmed** duplication. Now one `openHostedBrowserTab` in `lib/hosted-browser.ts` (uses `isElectron`, now exported from `hooks/useIsElectron.ts`). Listed as stateless in `store-reset.test.ts`.
- `toChromeUserAgent` lived in shared plus an Electron re-export file: **confirmed** (two homes). Electron imports it from `@taskflow/shared`; the test moved to `packages/shared/src/utils/`.
- `TabItem`'s `TabItemOverlay` doc comment ended up above the new `AgentMarker`: fixed.
