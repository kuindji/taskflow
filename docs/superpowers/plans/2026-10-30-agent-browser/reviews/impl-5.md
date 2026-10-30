The new control-server routing is incompatible with the existing backend client, breaking tab creation and closure. Forty pure-module tests passed; seven socket-based tests were blocked by sandbox listener restrictions.

Review comment:

- [P1] Preserve the secret prefix in backend host requests — /Users/kuindji/Projects/taskflow/electron/src/browser-host/control-server.ts:15-19
  The existing `createBrowserHostClient` resolves `/tabs/ensure` and `/tabs/close` using `new URL(path, controlUrl)`, which discards the new secret path prefix. Consequently, both operations hit these routes without the secret and receive 404: browser-tab creation fails with `BrowserHostUnavailableError`, and backend-requested closures cannot destroy hosted views. Update the client to append routes beneath the secret prefix and add a client-to-server integration test.
