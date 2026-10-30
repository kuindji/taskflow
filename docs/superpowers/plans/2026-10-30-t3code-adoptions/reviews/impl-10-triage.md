# Section 10 review triage

Review: `impl-10.md` (`codex exec review --base b9d9c1e9`, gpt-6.1-sol). One finding, reported twice.

1. **P2, macOS staging failure after `update-downloaded`: confirmed, fixed in 205473a0.** In electron-updater 6.8.3, `MacUpdater.updateDownloaded` calls `dispatchUpdateDownloaded` before Squirrel's `checkForUpdates`, and its promise resolves once the proxy has piped the zip, before Squirrel validates the signature. The controller latched `outcomeReceived` on the early event and dropped the staging error, or the error arrived with no operation active. Either way the app showed Restart, and `quitAndInstall` (with `squirrelDownloadedUpdate` false) only waits for a Squirrel event, so the state stayed `installing` with every action disabled. Fix: on darwin the adapter sends `download-completed` on Squirrel's native `update-downloaded`. The controller keeps a download active after its promise settles until its outcome or a failure, so a later staging error is a retryable download failure. Tests: `a download that settles before its completion event stays active`, `a staging error after the download settles fails the download` (both failed before the fix).

Own observations (minor, no change):

- A check whose promise resolves with no outcome event leaves `checking`. Packaged electron-updater always emits an outcome or an error. Only unpackaged dev hits this, from the menu (`checkForUpdates` returns null), and the old code got stuck the same way there.
- An automatic startup check that fails (for example offline) now shows the accent update button with the failure and Retry in the sidebar. Before, the state went back to idle silently. This is plan behavior (distinct check errors with Retry); the user can judge it in Section 13.
