Remote normalization breaks self-hosted instances using non-default HTTPS ports. The focused adapter and dialog tests passed, but WebSocket tests were blocked by sandbox listener restrictions.

Review comment:

- [P2] Preserve HTTPS ports when normalizing remotes — /Users/kuindji/Projects/taskflow/packages/backend/src/services/git-pr.ts:68-70
  For a self-hosted remote such as `https://git.example:8443/group/repo.git`, `parsed.hostname` drops `:8443`. Consequently, authentication checks target `git.example`, and GitLab lookup uses `https://git.example/group/repo`, rather than the configured instance. This makes lookup and creation fail despite valid CLI authentication. Preserve the HTTP(S) authority, including its port, while treating SSH transport ports separately.
