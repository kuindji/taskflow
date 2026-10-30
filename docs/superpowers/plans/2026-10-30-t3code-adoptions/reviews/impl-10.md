Changes required. The 25 focused tests and Electron/UI typechecks pass, but the reproduced macOS staging-failure path leaves updating stuck without a usable retry.

Review comment:

- [P2] Handle macOS staging failures after the download event — /Users/kuindji/Projects/taskflow/electron/src/update-controller.ts:46-47
  On macOS, `MacUpdater.updateDownloaded()` emits `update-downloaded` before native Squirrel staging begins, so the download promise can still reject afterward. Because that event sets `outcomeReceived`, this guard discards both the native error and the rejection, leaving the update falsely marked ready. Reproducing this sequence with the installed updater leaves “Restart Now” transitioning permanently to `installing`: Squirrel has no staged update, and `quitAndInstall()` only registers a completion listener without restarting staging. Handle these failures as retryable download failures rather than treating the early event as definitive success.
