## 1. Area summary

Taskflow already has SSH tunnels with explicit loopback forwarding, host-key approval, and keepalives in [tunnel-args.ts](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/tunnel-args.ts:78). Its backend [refuses non-loopback binds](/Users/kuindji/Projects/taskflow/packages/shared/src/utils/backend-host.ts:27).

LAN discovery supplies hints; [backend-records.ts](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/backend-records.ts:118) uses datagram source addresses, and the registry confirms backend identity after connecting. Desktop supports several attached backends; TUI switches between machines and automatically reopens failed tunnels.

t3code adds authenticated HTTP/WebSocket sessions, SSH bootstrap, Tailscale HTTPS, and managed Cloudflare tunnels. Its [relay connector](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/infra/relay/src/environments/EnvironmentConnector.ts:574) authorizes connections; normal application traffic uses the selected environment endpoint.

Mobile shares t3code’s connection runtime, keeps credentials in [secure storage](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/mobile/src/connection/catalog-store.ts:46), and reacts to foreground and network-path changes. These mechanisms work independently of its chat model.

## 2. Recommendations

1. **Add an authenticated WebSocket upgrade policy. Effort M; reimplement.**

   Taskflow [upgrades requests unconditionally](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/server.ts:69), before checking origins or credentials. Accepted connections can invoke [session creation and PTY input](/Users/kuindji/Projects/taskflow/packages/backend/src/handlers/session.ts:29). Loopback binding prevents direct LAN access but leaves a browser-origin boundary unprotected whenever browser policy permits localhost WebSockets.

   Take the policy from t3code’s [EnvironmentAuth.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/auth/EnvironmentAuth.ts:674): authenticate upgrades and restrict browser origins. Implement a small bootstrap/token mechanism appropriate to Taskflow, rather than importing its OAuth/Effect stack. Taskflow’s production Electron renderer [loads a file](/Users/kuindji/Projects/taskflow/electron/src/window-manager.ts:162), so accepting every `Origin: null` would be an inadequate shortcut. Account for UI, TUI, CLI, and tunneled clients. This protects terminal access without changing agent execution.

2. **Disable SSH connection multiplexing for application-owned connections. Effort S; copy the settings with attribution.**

   t3code explicitly sets `ControlMaster=no`, `ControlPath=none`, and `ControlPersist=no` in [ssh/tunnel.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/packages/ssh/src/tunnel.ts:1140).

   Taskflow inherits these options from user configuration, while [tunnel-manager.ts](/Users/kuindji/Projects/taskflow/packages/shared/src/remote/tunnel-manager.ts:496) assumes killing its child closes its forwarding. An existing SSH master can instead own forwarding and avoid fresh host-key negotiation. That conflicts with both cleanup and application-owned trust assumptions. An isolated `ssh -G` probe confirmed that Taskflow’s current arguments retain synthetic `ControlMaster auto`, `ControlPath`, and `ControlPersist yes` settings.

   Put the overrides in reusable SSH arguments covering both tunnel creation and remote port reads. This is a direct fit for PTY-first remote access.

3. **Give desktop remote connections automatic recovery outside the LAN. Effort M; reuse Taskflow code and reimplement selected t3code techniques.**

   Desktop’s [backend-store.ts](/Users/kuindji/Projects/taskflow/packages/ui/src/stores/backend-store.ts:578) drops the connection after tunnel exit. Recovery then needs manual Retry or a discovery beacon. Across the internet, that beacon never arrives. The TUI already has [automatic tunnel reattachment](/Users/kuindji/Projects/taskflow/packages/tui/src/opentui/machine-session.ts:399); share that behavior before adding another implementation.

   Borrow wake/network-triggered probing and jittered backoff from t3code’s [connection/supervisor.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/packages/client-runtime/src/connection/supervisor.ts:695). Its mobile [platform.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/mobile/src/connection/platform.ts:85) also catches Wi-Fi-to-cellular changes that leave connectivity “online.”

   Preserve Taskflow’s [sequence-aware terminal snapshots](/Users/kuindji/Projects/taskflow/packages/tui/src/opentui/session-bridge.ts:146). Reconnect and resynchronize; never automatically replay uncertain terminal input.

4. **If phone access becomes a product goal, start with authenticated Tailscale HTTPS. Effort L end-to-end; reimplement.**

   t3code’s [tailscale.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/packages/tailscale/src/tailscale.ts:430) wraps HTTPS Serve setup, teardown, and endpoint probing. Pair that idea with expiring, atomically consumed credentials from [PairingGrantStore.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/auth/PairingGrantStore.ts:550), revocable sessions, and secure client storage.

   This would let a phone control Taskflow’s existing terminal protocol without SSH embedded in the client. Authentication must precede exposure. Current desktop/TUI users can already use SSH over tailnet addresses, so this is conditional.

## 3. Considered and rejected

- **Hosted relay now.** t3code’s [ManagedEndpointRuntime.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/cloud/ManagedEndpointRuntime.ts:605) manages cloudflared, recovery, and credentials. The operational cost is substantial; existing SSH already supports reachable hosts and configured jump hosts.
- **Whole client-runtime or SSH package.** Effect services, contracts, cloud authorization, and remote installation make wholesale copying expensive.
- **Peer delegation and guest chat sharing.** [PeerForwarding.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/peer/PeerForwarding.ts:40) forwards agent tools and thread operations. That is outside Taskflow’s terminal transport model.

## 4. Uncertainties

Read-only inspection covered Taskflow `7a57f492` and t3code `32ecd717`. The isolated WebSocket probe could not bind here. Browser exploitation, SSH multiplexing lifecycle, mobile devices, and NAT traversal were not verified end-to-end. No files were modified.