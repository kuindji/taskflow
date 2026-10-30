Changes required.

1. **Blocker — unauthenticated WebSocket through the identity route.** [auth.ts:66](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/auth.ts:66), [server.ts:113](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:113). A raw `GET /` with valid WebSocket key/version headers and `Upgrade: websocket, h2c`, without credentials or Origin, passes authentication: `isUpgradeRequest()` returns false, so it receives the identity-probe exemption. The server then attempts an app upgrade. Bun accepts comma-separated Upgrade tokens, allowing the socket into `clients` and the full router, including sessions, PTY input, settings, and files. The predicate bypass was reproduced; the upgrade consequence follows [Bun 1.4.2’s implementation](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/runtime/server/server_body.rs#L1766-L1776). **Fix:** parse Upgrade tokens consistently with Bun, and return the ordinary identity response before attempting any upgrade on an exempt request. Add a raw TCP regression test.

2. **Major — concurrent schedule registration can kill a successfully spawned job.** [scheduler-service.ts:264](/Users/kuindji/Projects/taskflow/packages/backend/src/services/scheduler-service.ts:264), [schedule-store.ts:54](/Users/kuindji/Projects/taskflow/packages/backend/src/services/schedule-store.ts:54). When schedules A and B start together, B’s registration truncates `schedules.json` during `writeFile`. If A’s spawn resolves then, its new, unlocked `getById()` reads incomplete JSON. The exception reaches the cleanup handler, which closes A’s session at line 306. An in-memory filesystem reproducer returned `Unexpected EOF` and recorded `closeSession("session-a")`. **Fix:** publish every schedule-store write through atomic temp-file replacement, so concurrent readers always receive complete JSON.

3. **Minor — auth-only subprotocol offers echo the token.** [auth.ts:48](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/auth.ts:48). Offering only `taskflow.auth.<token>` makes `upgradeHeaders()` return `undefined`. Bun then uses the request’s offered protocol as its default response, echoing the token before the unauthorized socket closes with 4401. This violates the explicit no-echo requirement. **Fix:** explicitly suppress protocol negotiation when `taskflow` was not offered; do not rely on Bun’s default. [Bun’s protocol selection](https://github.com/oven-sh/bun/blob/bun-v1.4.2/src/runtime/server/server_body.rs#L1713-L1840).

No additional findings by area:

- Host/Origin allowlists and DNS rebinding checks.
- CDP HMAC derivation and cross-tab key isolation.
- Token persistence, rotation, and spawn handshake.
- Electron, renderer, TUI, CLI, SSH quoting, and one-refresh handling.
- Terminal resync and replay-reply suppression.
- Git literal pathspecs and worktree removal.
- Preview limits and save blocking.
- Codex/Pi discovery.
- Desktop updater.
- Editor resolver.
- GitLab MR adapter.

Read-only review completed for the requested range; the commit log was read. Fresh test reruns were blocked by sandbox temporary-file and listener restrictions. The auth predicate and scheduler race were reproduced without repository edits; the malformed upgrade was not exercised over a live socket.

