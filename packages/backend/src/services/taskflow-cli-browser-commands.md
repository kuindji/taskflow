## Browser commands

`taskflow-cli browser open "<url>" [--label "<text>"] [--project|--master]` Open a browser tab
`taskflow-cli browser "<url>" [--label "<text>"] [--project|--master]` Open a browser tab, legacy form
`taskflow-cli browser list [--project|--master]` List tabs and their CDP endpoints
`taskflow-cli browser close <tabId>` Close a tab

Without a scope flag, commands use the current task, then the project, then master context. `--project` and `--master` force that scope.

Opening a tab prints JSON:

```json
{"tab":{"id":"<id>"},"endpoint":"http://127.0.0.1:<port>/cdp/<id>"}
```

Connect with Playwright using the printed endpoint:

```js
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0].pages()[0];
```

For Puppeteer, use `puppeteer.connect({ browserURL: endpoint })`.

- The endpoint shows only this tab and pages it opens.
- `context.newPage()` opens another tab in the same task.
- Prefer just exiting when finished. Call `browser.close()` only on Playwright's connected browser, where it disconnects. Taskflow refuses to quit.
- Reconnect later with `taskflow-cli browser list`. After an app restart, rediscover the endpoint because its port may change.
- The tab keeps running when the user looks elsewhere.
- The user may also be using the tab.
