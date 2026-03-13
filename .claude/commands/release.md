Release a new version of Taskflow to GitHub Releases.

## Pre-checks

Run all of these checks before proceeding. If any fail, stop and report the issue.

1. **Clean working tree**: Run `git status` and verify there are no uncommitted changes (staged or unstaged). Untracked files in `.claude/` are acceptable.
2. **On main branch**: Verify the current branch is `main`.
3. **Pushed to remote**: Run `git log origin/main..main` and verify there are no unpushed commits. If there are, ask the user whether to push them first.
4. **Version bumped**: Read the `version` field from `electron/package.json` and compare it to the latest git tag (use `git tag --sort=-v:refname | head -1`). The version must be strictly greater than the tag. If not, stop and tell the user to bump the version in `electron/package.json` first.

## Release steps

Once all pre-checks pass:

1. Get a GitHub token by running `gh auth token`.
2. Create a git tag `v{version}` and push it to origin.
3. Run the release build: `GH_TOKEN={token} bun run release`
4. After the build completes, verify the release was published by running `gh release view v{version}`.
5. Report the release URL to the user.
