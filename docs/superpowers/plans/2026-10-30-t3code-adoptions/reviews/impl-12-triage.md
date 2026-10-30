# Section 12 triage

Base `9963b71b`, Sol commit `9b7f3f5c`, fixes `d25ab5af`.

## Codex review (`impl-12.md`)

- P2 HTTPS port dropped from remote host: **confirmed**. `new URL(...).hostname` drops `:8443`, so `auth status --hostname` and the GitLab `--repo` URL targeted the wrong instance. Fixed: HTTP(S) remotes keep `host` (with port); `ssh://` keeps `hostname` (its port is transport only). Test `an HTTPS remote keeps its port in the host`.

## Own review

- Minor, **fixed**: TaskHeader showed the unavailable message and Retry on every header whose lookup was unavailable, including projects and local repos without a remote (`No supported pull request provider for remote host unknown` permanently). The section says next to the request action: now shown only with the create action or a known request.
- Minor, **fixed**: TaskCard's branch tooltip was replaced by the unavailable message, so local-only worktrees lost their branch name. Now the branch, then the message.
- Noted, no change: sidebar polling now covers every worktree task (plan behavior) and each lookup runs an `auth status` first, so a poll costs two or three CLI runs per task every 30 s.
- Noted, no change: dialog Retry re-runs `GIT_STATUS` with the lookup, resetting the create checkbox (it is disabled while unavailable anyway).
