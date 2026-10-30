# Handoff: Agent-Drivable Internal Browser

Keep this file short. It is the only state carried between sessions. Update the row and add facts the next section needs. Don't add narrative.

Plan: `../2026-10-30-agent-browser.md`. Spec: `docs/superpowers/specs/2026-10-30-agent-browser-cdp-design.md`. Chain protocol: `chain.md`.

## Next step

Review Section 5, including its deferred manual smoke test, then implement Section 6.

## Status

| # | Section | Status | Commits |
|---|---|---|---|
| — | Plan review round 1 | done: 1 blocker and 14 majors confirmed and folded in; round 2 output saved | 3b82b51e |
| — | Plan review round 2 | done: 1 blocker, 7 majors, 1 minor + 1 own major confirmed and folded in; round 3 output saved | 0286d1f4 |
| — | Plan review round 3 | done: 1 blocker, 3 majors, 1 minor confirmed and folded in; round 4 output saved | 84c0815b |
| — | Plan review round 4 (cap) | done: 1 blocker, 2 majors, 1 minor confirmed and folded in; chain stopped for the user | cd1699ab |
| 1 | Spike (gate) | done: PASS, 3 clients × all criteria; plan amended | 3d910bb8, 7a57f492 |
| 2 | Shared types, store, host client, service | done: review had 1 finding (late `ensure` after close), confirmed and fixed | e78299eb, 0a8c1025, caf2df69, cdb54a6f |
| 3 | HTTP/WS API, wiring, cleanup hooks | done: review clean, no fixes | ac8169ba |
| 4 | CDP gateway | done: review had 1 finding (worker targets stalled the ordered stream), confirmed and fixed | e1ebcb34, 07e1af62 |
| 5 | Electron host | implemented: 47 host tests, 66 Electron tests, 425 UI tests (69 files individually), typecheck/lint/format/build pass; Step 8 deferred to reviewing session | feat(electron): browser host with WebContentsView tabs |
| 6 | UI | not started | |
| 7 | CLI, doc, prompt | not started | |
| 8 | Manual verification, final review | not started | |

## Facts for the next section

- Base commit before implementation (final-review base): `91a3e89c`.
- Section 2 outputs: `browserTabLabel(url)` lives in `packages/shared/src/utils/browser-tab-label.ts` (exported from the shared index; `terminal-links.ts` uses it). `BrowserTabStore` exports `SavedBrowserTab`. The service's deps type is `BrowserTabServiceDeps` (not exported). The staleness timer re-checks 1 ms past 15000 ms, because availability includes the 15000 ms boundary.
- Section 3 outputs: `registerBrowserRoutes` (`api/routes/browser-routes.ts`) wraps each handler with an error→status mapper (400/404/503); Section 4 adds the `/cdp/:tabId/json*` routes there via a required `ApiRouteDeps.cdpGateway`. The service is built in `index.ts` right after `store.init()`; `browserTabService.init()` runs just before `server.start()`. Task/project route and handler deps take `browserTabService: Pick<BrowserTabService, "closeForOwner">`; `registerProjectHandlers` takes it positionally (4th arg).
- Section 4 outputs: `createCdpGateway({ service })` (`services/cdp/cdp-gateway.ts`, exports `CdpGateway`, `CdpSocketData`) is `createServer`'s 4th argument and `ApiRouteDeps.cdpGateway`. CDP sockets aren't app clients and get no broadcasts. `pageOfTabTarget` and `runOnRootPage` use separate short-lived upstream sockets. The filter denies recorded target types other than `page`/`tab` without a `resolveTarget` wait (workers, browser); nested attaches under allowed sessions still pass. `WebMCP.enable` is denied (unknown domain, Puppeteer tolerates it); no spike method needed a table addition.
- Host-side expectation for Section 5: any page target that isn't a tab (main window, park window, any other app window) must be in `appTargetIds`, or every decision about it costs a 2 s wait in the gateway's ordered stream.
- Section 5 outputs: `electron/src/browser-host/index.ts` exports `initBrowserHost`, `detachAll`, and `isParkWindow`. Preload exposes `window.taskflow.browser`; `browser:nav-state` sends separate `tabId` and state arguments. The factory reports every live BrowserWindow's renderer in `appTargetIds`, including the park window.
- Section 5 execution: Step 8 was skipped at the user's direction; no dev app was started. The referenced Superpowers execution skills were unavailable, so the written TDD sequence was followed directly. Electron tests cannot import the backend's `expectRejects` helper because it is outside Electron's TypeScript `rootDir`; the pending-close test asserts rejection inline instead.
- `load` (used by `open`, `openChild`, `ensureLoaded`) throws `BrowserTabNotFoundError` and closes the host view when the tab was closed while `ensure` was pending.
- Running Sol: `codex exec -m gpt-6.1-sol -s workspace-write -c sandbox_workspace_write.network_access=true --add-dir "$PWD/.git" -C "$PWD" -o <report> - < <brief>`. Without `--add-dir .git` it can't commit (`.git` is read-only under workspace-write). In its sandbox the backend process-stopper and watcher tests fail (19); rerun the suite yourself outside it.
- Spike facts: full detail in `spike/results.md` (method log, raw facts). Summary:
  - Debug port: `<userData>/DevToolsActivePort`, line 1 = port, line 2 = `/devtools/browser/<uuid>`; present right after `ready`.
  - Hidden views live in one hidden park window (1280×800). A view in no window has a 0×0 viewport; one removed from a window stops painting after a client reconnect. The park window's renderer goes in `appTargetIds`; any unlisted page target costs a 2 s `resolveTarget` wait.
  - Guest popups: wrap with `webPreferences` = tab prefs minus `partition` (none: preload lost; with `partition`: SIGSEGV on the next view). All popup kinds, `_blank` forms included, take the guest path. `window.opener` null for plain `_blank` and forms, set for `rel=opener` and `window.open`.
  - `disable-blink-features=AutomationControlled` is needed: remote debugging makes `navigator.webdriver` true and the preload can't reach the main world.
  - Contexts: tabs share one `browserContextId`, the app another; Chromium can't resolve the tabs' id. Context-scoped handling: download behaviour no-op `{}`, cookies via `Network.*` on the root page (`runOnRootPage`), permissions refused.
  - `Target.createTarget`: Electron says `Not supported`; intercept, hold the reply until the attach is forwarded, host awaits the `about:blank` load.
  - Tab targets: one per WebContents; the attach + nested auto-attach mapping works in 1–3 ms, also for paused new tabs.
  - Puppeteer sends `WebMCP.enable` per page session (denied, tolerated) and `Browser.close` on `browser.close()` (denied; forwarding it quits the app).
- Spike client installs (`playwright-core`, `puppeteer-core`) live outside the repo; Section 8 reinstalls them in a scratch dir. `uv run --no-project --with playwright python <file>` runs the Python client.
- `eslint.config.js` ignores `docs/superpowers/plans/**/spike/` (spike scripts aren't in any tsconfig).
- `bun test packages/ui` run as one command has pre-existing failures from `mock.module` leakage. Judge UI tests file by file.
- Tests asserting rejections use `expectRejects` from `packages/backend/tests/expect-rejects.ts`.
- Shell is zsh: `$F` file lists don't word-split. Pass files to eslint and prettier explicitly.
- Section order is now 2, 3, 4, 5, 6, 7 (round 2 changed it; `chain.md` updated).
- Electron v33.4.11 and Chromium 130 sources can be fetched from raw.githubusercontent.com (`electron/electron/v33.4.11/...`, `chromium/chromium/130.0.6723.191/...`) to check review claims.
- `bunx tsc --ignoreConfig --noEmit --strict --skipLibCheck --moduleResolution bundler --module esnext --target es2022 .probe/p.ts`, run from `electron/` with a throwaway `.probe/` dir, type-checks Electron API claims against the installed 33.4.11 typings.
- `electron/package.json` may carry an uncommitted version bump by the user. Don't commit it.

## Deviations from the spec

- Amendment 11 (spike): context-scoped commands aren't pinned to the tabs' context (impossible under Electron); download behaviour is a no-op, cookies go through the page, permissions are refused. Downloads aren't reported to agents.
