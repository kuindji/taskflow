Implemented Section 3 with TDD. No push.

Commits:

- `99d98f43` feat(cli): devserver add, list and remove (sh)
- `0c56612a` feat(cli): devserver add, list and remove (binary)
- `71a3f273` feat(backend): devserver command doc and agent prompt paragraph
- `c836a270` docs: record devserver CLI implementation handoff

Commands and results:

| Command | Before implementation | After |
|---|---|---|
| `bun test tests/services/taskflow-cli.test.ts` | 28 pass, 12 expected failures | 40 pass |
| `bun test tests/services/taskflow-cli-bin-session.test.ts` | 8 pass, 8 expected failures | 16 pass |
| `bun test tests/services/internal-agent-skill.test.ts` | 36 pass, 5 expected failures | 41 pass |
| Backend `bun test` | | 916 pass, 2 skip, 0 fail |
| `bun run typecheck` | | PASS |
| Scoped `bunx eslint`, Prettier write/check | | PASS |
| `sh -n`, `dash -n`, `git diff --check` | | PASS |

Deviations: none. The existing untracked brief remains untouched.