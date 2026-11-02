# S6 — Remote machine identity: new IP and taken port

Code: `packages/shared/src/remote/` (`backend-registry.ts`,
`backend-records.ts`, `tunnel-manager.ts`, `tunnel-args.ts`),
`packages/shared/src/discovery/`, the backend's `GET /` in
`packages/backend/src/ws/server.ts`. Electron and TUI both use the shared
registry (`electron/src/main.ts`, `packages/tui/src/remote/`).

## A10 R1-2: saved discovered machine whose IP changed

Decision: re-point automatically only when the SSH host key matches.

- Today `matchesDiscovered` (`backend-records.ts:148`) matches by uid, so a
  beacon from the new address is hidden behind the saved record, which keeps
  dialing the old `host`.
- When a live beacon matches a saved record by uid but its `address` differs
  from `record.host`, probe the new address
  with ssh using `HostKeyAlias=<hostKeyAlias(record)>` and
  `StrictHostKeyChecking=yes` against `KNOWN_HOSTS_FILE`
  (`tunnel-args.ts:11-31`, reuse its option builder).
  - Key matches → update `record.host` to the new address, append the same
    key line under the new alias in `KNOWN_HOSTS_FILE`, persist, reconnect if
    the record is attached.
  - Mismatch or no answer → leave the record, and let the beacon show as its
    own menu entry (normal attach + trust dialog). Do not loop probes: probe a
    given (record, address) pair once per beacon appearance.
- Records carry no origin field (`BackendRecord`,
  `shared/src/types/backend.ts:29`), so "created from discovery" cannot be
  checked. Use instead: re-point only when `record.host` is an IP literal
  (what discovery saves); a hand-typed hostname is left alone. No new field.
- The registry's discovery callback (`backend-registry.ts:229`) only reacts
  to a uid that was not present before, so a new address for a uid still in
  the list (old beacon not yet expired, or the same machine re-announcing
  from a new IP) is never seen. Detect new (uid, address) pairs on their own;
  forget a pair's probe attempt when that pair leaves the list.
- Serialize with the existing per-backend registry mutation queue.

## A10 R2-2: remembered port taken by another instance

Decision: `GET /` names the instance; the readiness probe requires a match.

- Backend `GET /` answers `Taskflow backend <instanceId> <backendUid>`
  (today "Taskflow backend"). Keep it unauthenticated; both values are
  already in the beacon.
- `waitForBackend` (`tunnel-manager.ts:79`) gets the expected identity:
  the record's `backendUid` if set, else its `instanceId`. Body
  `Taskflow backend` with no identity (older backend) is still accepted.
  A mismatch means "not this backend": the candidate fails fast (no 10 s
  wait) and `backendPortCandidates` (`backend-registry.ts:162`) moves on.
- Check every other consumer of the `GET /` string (grep
  `Taskflow backend`), e.g. local readiness checks in Electron or the CLI.

Tests: records/registry tests for re-point on key match, no re-point on
mismatch, no re-point for a hostname record, a new address while the old
beacon is still listed, one probe per pair until it disappears and comes back; probe test for match, mismatch, legacy body; backend test for the
new `/` body.
