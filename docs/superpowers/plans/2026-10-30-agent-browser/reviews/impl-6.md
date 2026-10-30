The native-view integration misses the existing connection overlay, leaving hosted pages above the app's disconnect blocker. The UI typecheck passes, but this integration regression needs correction.

Review comment:

- [P2] Include the connection blocker in native-view overlay handling — /Users/kuindji/Projects/taskflow/packages/ui/src/components/panes/HostedBrowserPane.tsx:38-45
  When the backend connection drops while a hosted browser is visible, `App.tsx` mounts `ConnectionOverlay`, but that overlay never registers with this registry. The pane remains mounted, so its native `WebContentsView` stays above the renderer DOM, obscuring the reconnect/error message and accepting page input through the full-screen blocker. Register `ConnectionOverlay` as an overlay, or hide hosted views while disconnected.