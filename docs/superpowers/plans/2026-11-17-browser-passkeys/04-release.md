# Section 4 — Final review, owner checks, release

**Goal:** Do a whole-branch review. The owner registers and uses a passkey with Touch ID in a signed build. Then the release is published (owner approves first). The owner confirms the installed app auto-updates and passkeys work in the updated app.

- [ ] **Step 1: Final review**

Run `codex exec review --base <final-review base from handoff> -m gpt-6.1-sol -c sandbox_mode=read-only` → `reviews/final.md`. Triage it in `reviews/final-triage.md`, fix the confirmed findings, and commit. If fixes touched `electron/src`, rerun typecheck, oxlint and `bun test` in `electron`.

- [ ] **Step 2: Version bump**

Set `electron/package.json` `version` from `0.16.1` to `0.17.0` (a new Electron major and a new feature). Repo convention is that this file only changes, and the message is `version bump`.

```bash
git add electron/package.json
git commit -m "version bump"
```

- [ ] **Step 3: Notarized local build for the owner's hand check**

Run `bun run dist` at the root. This builds a notarized arm64 dmg and zip. It needs the `taskflow-notarize` keychain profile. Check:
- `spctl -a -vv -t exec electron/release/mac-arm64/Taskflow.app` reports `accepted` / `Notarized Developer ID`;
- `Contents/embedded.provisionprofile` is in the bundle, and the signed entitlements match Section 1 Step 11.

If notarization fails for credentials, record that, use the `bun run package` build for the owner's Touch ID check, and mark notarization **pending** in the status table. Don't treat the `spctl` check as passed. Publishing (Step 5) needs a passing notarized build, so the owner must fix the credentials first. Add that to the owner instructions.

- [ ] **Step 4: Stop for the owner (owner-gated)**

Write these instructions under **Next step** in `handoff.md`, then stop the chain and run `taskflow-cli notify "Passkeys: ready for your Touch ID check and release approval"`:

> 1. Keep your normal Taskflow running. Start the test build sandboxed so it never touches your real data:
>    `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=/tmp/passkeys-check electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow`
>    (`TASKFLOW_CONFIG_DIR` now also holds the browser profile.)
> 2. In a browser tab in that window, open https://webauthn.io. Enter a username, click **Register**, and touch Touch ID. Then click **Authenticate** and touch again. Both should succeed.
> 3. Passkey sign-in without a username: reload webauthn.io, leave the username empty, and click **Authenticate**. It should go straight to Touch ID (one passkey) and succeed.
> 4. Two accounts: register a second username, reload, leave the username empty, and click **Authenticate**. A "Choose a passkey" dialog should list both. Pick one and touch: it signs in as that account. Repeat and click **Cancel**: the page reports a failure and nothing hangs.
> 5. A real site you use: add a passkey, sign out, and sign back in with it.
> 6. If all of this works, start a session with "Passkeys: publish approved" (or run `bun run release:mac-all` yourself). If anything fails, start a session with "Passkeys: owner check failed: <what you saw>".

If the owner reports a failure, don't publish. Record what they saw under **Next step** as "Owner check failed: <summary>". Investigate in that session, and fix it if the fix doesn't change the design (then go back to Step 3). Otherwise stop and notify.

- [ ] **Step 5: Publish (only after explicit owner approval in the new session)**

Only with a passing notarized build (Step 3). Run `bun run release:mac-all`. This publishes a GitHub release for x64 and arm64, notarized. Expected: the release `v0.17.0` exists with mac dmg/zip and `latest-mac.yml`. Linux and Windows are not built in this plan, so the published release has mac assets only. Tell the owner this.

- [ ] **Step 6: Owner's post-release checks (owner-gated)**

Write under **Next step**, then stop and notify:

> In your installed Taskflow (0.16.1): let it auto-update to 0.17.0, or use the update button. After the restart, check that the About/version shows 0.17.0, then open a browser tab, go to https://webauthn.io, and register and authenticate with Touch ID (also once with the username empty). Passkeys made in the sandboxed test build don't carry over; register again. Reply "Passkeys: release confirmed" or "Passkeys: release check failed: <what you saw>".

- [ ] **Step 7: Close out**

Only when the owner confirms that the update and passkeys work in the installed app:
- Status rows done. **Next step** → "None: complete".
- Add the owner notes from Facts to the final notify (for example, the `dev:electron` script bug).

If the owner reports a failure instead: record it under **Next step** as "Release check failed: <summary>", leave the status rows open, then stop and notify. The fix (and maybe a 0.17.1) is a new decision for the owner.
- Update the Claude memory resume point (`project_browser_passkeys_status.md` + the `MEMORY.md` line). Note: Touch ID passkeys are device-bound and Taskflow-only; synced passkeys are not possible via Electron's `platformPasskeys` for arbitrary sites.
- Commit and notify.
