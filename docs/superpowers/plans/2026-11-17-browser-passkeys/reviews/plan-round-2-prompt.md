# Plan review round 2: browser passkeys (Electron 45 + Touch ID)

You are reviewing an implementation plan before any code is written. Read-only; do not modify files.

## What to review

- Spec: `docs/superpowers/specs/2026-11-17-browser-passkeys-design.md`
- Plan index: `docs/superpowers/plans/2026-11-17-browser-passkeys.md`
- Chain protocol: `docs/superpowers/plans/2026-11-17-browser-passkeys/chain.md`
- Handoff: `docs/superpowers/plans/2026-11-17-browser-passkeys/handoff.md`
- Sections: `docs/superpowers/plans/2026-11-17-browser-passkeys/01-preflight.md`, `02-electron-upgrade.md`, `03-touchid.md`, `04-release.md`
- Probe script: `docs/superpowers/plans/2026-11-17-browser-passkeys/spike/webauthn-probe.ts`

Check the plan against the real code in `electron/` (main process sources in `electron/src/`, `electron/package.json` build config, entitlement plists, signing/notarize scripts) and the repo's build/release scripts.

## Goal of the work

"Sign in with passkey" works in Taskflow's integrated browser (an Electron `WebContentsView`-based tab browser in partition `persist:browser`) on the owner's Mac through Touch ID. Approach: upgrade Electron 33.4.11 → 45.3.3, add the `keychain-access-groups` entitlement `9SX8S58CA8.com.taskflow.app.webauthn` to the Developer ID–signed, notarized app, and call `app.configureWebAuthn({ touchID: ... })` at startup. A preflight (Section 1) proves the entitlement can be signed and the app launched on Electron 33 before the upgrade.

## Look for

1. Wrong file/line/symbol claims: every path, line number, function name, config key, and script the plan cites must exist and say what the plan says it says.
2. Wrong Electron 45 / electron-builder 26 assumptions, especially:
   - the exact name, signature, options shape, timing (before/after `ready`), and platform behaviour of `app.configureWebAuthn` (or whatever Electron 45 actually exposes for Touch ID WebAuthn), and the TypeScript type name for its options;
   - the on-demand binary download introduced around Electron 42 (how `electron` npm package obtains its binary, impact on `bun install`, CI, electron-builder packaging, offline builds);
   - other breaking changes between Electron 33 and 45 that affect this codebase (APIs used in `electron/src/` that were removed/changed: dialogs, notifications, `WebContentsView`, session/partition, CDP/remote debugging, `protocol`, `webContents` events, `setWindowOpenHandler`, etc.);
   - signing/entitlements: whether `keychain-access-groups` on a Developer ID (non–App Store) app requires a provisioning profile / `com.apple.application-identifier` / `com.apple.developer.team-identifier`, whether AMFI will kill the app at launch without one, how electron-builder 26 applies `entitlements` vs `entitlementsInherit` to helpers, and whether `provisioningProfile` is supported for Developer ID in electron-builder 26;
   - notarization implications of the new entitlement.
3. Missing spec requirements: anything the spec requires that no section implements or verifies.
4. Unsafe or irreversible steps that are not owner-gated (publishing, pushing, touching the owner's real Taskflow data/config, modifying Apple Developer portal state, deleting keychain items, global installs, etc.).
5. Steps that a fresh agent cannot actually execute as written (missing commands, ambiguous verification criteria, gate conditions that cannot be observed, tests that cannot be written against the stated interfaces), and inconsistencies between sections, the index's "Cross-section interfaces", and the handoff.

## Round 1 follow-up

This is round 2. Round 1's report is `docs/superpowers/plans/2026-11-17-browser-passkeys/reviews/plan-round-1.md` and its triage (what was confirmed and how it was fixed) is `reviews/plan-round-1-triage.md`. In addition to a fresh review:

6. For every confirmed round-1 finding (R1-1..R1-8, the type-name note, C1-1, C1-2), check that the fix is actually present in the plan files, is correct, and is consistent across sections, the index, the spec, and `handoff.md` (especially the launch recipe in handoff Facts, the dev-only `userData` override in Section 1, the `select-webauthn-account` handler in Section 3, the provisioning-profile path in Section 1, and the probe's 20 s abort).
7. Check that the fixes didn't introduce new problems (new wrong line numbers, steps that conflict, unsafe steps that aren't owner-gated).

Use IDs R2-1, R2-2, ... for this round.

## Report format

Write a markdown report. For each finding:
- ID (R2-1, R2-2, ...), severity (blocker / major / minor / nit)
- Location (plan file + section/step, and the code file:line it concerns)
- What is wrong, with evidence (quote the code or cite the docs/source you checked)
- Suggested fix

If you are unsure about an Electron/Apple fact, say how confident you are and what source you based it on (e.g. Electron source in node_modules, release notes, docs). End with a short list of things you checked and found correct.
