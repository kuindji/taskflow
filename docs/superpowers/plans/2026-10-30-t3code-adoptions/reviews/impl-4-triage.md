# Section 4 implementation review: triage

Codex (`codex exec review --base d2ec35bc`, gpt-6.1-sol, `impl-4.md`): no findings.

My own read of the diff (d2ec35bc..bddbd529):

- confirmed, minor, fixed: an empty `TASKFLOW_TOKEN` with `--connect` failed as a malformed token. It now counts as unset (`cli.ts`, test `an empty TASKFLOW_TOKEN counts as unset`).
- no change, minor: `ConnectionOverlay` shows "Connection Failed", the row's message and `Return to local` for any remote primary whose row has a failure. That includes a `reconnecting` row during automatic retries, which is what the plan text says ("a primary remote whose row has a `failure`"). Look at it in Section 13 item 5.
- no change, minor: exporting `switchRefusal` from `MachinesMenu.tsx` gives a `react-refresh/only-export-components` lint warning. The plan asked for the export (no copy). Warning only.
- no change: Sol's `runSsh` fix (exit code `0` on success, was `null`) also changes `readRemotePort` for a `cat` that succeeds with non-numeric output. It now gives the `no-backend` "Could not read Taskflow's port" message instead of `classifyTunnelFailure(stderr, null)`. That is more accurate, and `no-backend` keeps retrying.
- no change: Sol's deviation in both socket clients (a request made after Bun flips `readyState` but before the close event stays pending, so the `4401` close reason reaches it) is covered by `connection-registry.test.ts` and `client.test.ts`.
