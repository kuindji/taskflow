# Section 4 — Final review, owner checks, release

**Goal:** Do a whole-branch review. The owner registers and uses a passkey with Touch ID in a signed build. Then the release is uploaded as a GitHub draft (owner approves first) and the owner publishes it. The owner confirms the installed app auto-updates and passkeys work in the updated app.

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
- the profile-backed checks in Section 1 Step 11 ("Profile-backed checks") all pass on this bundle.

If notarization fails for credentials, record that, use the `bun run package` build for the owner's Touch ID check, and mark notarization **pending** in the status table. Don't treat the `spctl` check as passed. Uploading the release (Step 5) needs a passing notarized build, so the owner must fix the credentials first. Add that to the owner instructions.

If `handoff.md` Facts says the Section 2 notification check was **deferred**, add this to the owner instructions below, between items 1 and 2: "In the test build, add any folder as a project, start a shell session in it and run `taskflow-cli notify \"passkeys smoke\"`. A Taskflow banner with that text should appear. If it doesn't, report it as an owner check failure."

- [ ] **Step 4: Stop for the owner (owner-gated)**

Write these instructions under **Next step** in `handoff.md`, then stop the chain and run `taskflow-cli notify "Passkeys: ready for your Touch ID check and release approval"`:

> 1. Keep your normal Taskflow running. From the repo root, start the test build sandboxed so it never touches your real data:
>    `TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=/tmp/passkeys-check electron/release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow`
>    (`TASKFLOW_CONFIG_DIR` now also holds the browser profile.)
> 2. In a browser tab in that window, open https://webauthn.io. Enter a username, click **Register**, and touch Touch ID. Then click **Authenticate** and touch again. Both should succeed.
> 3. Passkey sign-in without a username: reload webauthn.io, leave the username empty, and click **Authenticate**. It should go straight to Touch ID (one passkey) and succeed.
> 4. Two accounts: register a second username, reload, leave the username empty, and click **Authenticate**. Touch ID asks first; touch it. Then a "Choose a passkey" dialog lists both accounts. Pick one: it signs in as that account. Repeat (touch again) and click **Cancel** in the chooser: the page reports a failure and nothing hangs.
> 5. A real site you use: add a passkey, sign out, and sign back in with it. Then delete that passkey in the site's account settings. Passkeys are tied to the browser profile, so this one only works in this test build. You'll check the real site again in the installed app after the update.
> 6. If all of this works, start a session with "Passkeys: upload approved". That uploads 0.17.0 to a GitHub **draft** release; you publish it yourself. If anything fails, start a session with "Passkeys: owner check failed: <what you saw>".

If the owner reports a failure, don't upload anything. Record what they saw under **Next step** as "Owner check failed: <summary>". Investigate in that session, and fix it if the fix doesn't change the design (then go back to Step 3). Otherwise stop and notify.

- [ ] **Step 5: Upload the draft (only after explicit owner approval in the new session)**

Only with a passing notarized build (Step 3). First, `gh release view v0.17.0 --json isDraft` must either fail (no release yet) or print `"isDraft": true`. If a published `v0.17.0` already exists, stop and notify: electron-builder only logs `GitHub release not created` and uploads nothing.

Run `bun run release:mac-all`. It builds and notarizes x64 and arm64 and uploads them. With no `releaseType` in `build.publish`, electron-builder uploads to a **draft** release (`electron-publish` `gitHubPublisher.js:52`). Check: `gh release view v0.17.0 --json isDraft,assets -q '{draft: .isDraft, assets: [.assets[].name]}'` shows `draft: true` and, for both `arm64` and `x64`, the dmg, the zip and their blockmaps, plus `latest-mac.yml`.

Don't publish the draft. Earlier releases (e.g. `v0.16.1`) also carry Linux assets (`latest-linux.yml`, AppImage), which this plan doesn't build. Publishing without them would break Linux updates, so it's the owner's call.

- [ ] **Step 6: Owner publishes, then post-release checks (owner-gated)**

Write under **Next step**, then stop and notify `Passkeys: v0.17.0 draft uploaded, ready for you to publish`:

> 1. The 0.17.0 release is a **draft** on GitHub with mac assets only. If you want Linux in it as usual, build and upload those first. Then publish it (GitHub UI, or `gh release edit v0.17.0 --draft=false --latest`).
> 2. In your installed Taskflow (0.16.1): let it auto-update to 0.17.0, or use the update button. After the restart, check that the About/version shows 0.17.0. Open a browser tab, go to https://webauthn.io, and register and authenticate with Touch ID (also once with the username empty). Passkeys made in the sandboxed test build don't carry over; register again. Then add a passkey on your real site and sign in with it once.
> 3. Reply "Passkeys: release confirmed" or "Passkeys: release check failed: <what you saw>".

In the session that gets the reply, first check `gh release view v0.17.0 --json isDraft` → `"isDraft": false`. If it's still a draft, the update check can't have worked: tell the owner and stop.

- [ ] **Step 7: Close out**

Only when the owner confirms that the update and passkeys work in the installed app:
- Status rows done. **Next step** → "None: complete".
- Update the Claude memory resume point (`project_browser_passkeys_status.md` + the `MEMORY.md` line). Note: Touch ID passkeys are device-bound, Taskflow-only and tied to the browser profile; synced passkeys are not possible via Electron's `platformPasskeys` for arbitrary sites.
- Commit, then notify. Add the owner notes from Facts to the final notify (for example, the `dev:electron` script bug).

If the owner reports a failure instead: record it under **Next step** as "Release check failed: <summary>", leave the status rows open, update the memory resume point to say so, commit, then stop and notify. The fix (and maybe a 0.17.1) is a new decision for the owner.
