# Handoff — Taskflow TUI Stage 2 flows and schedules

Plan: `docs/superpowers/plans/2026-08-25-taskflow-tui-stage2-flows-and-schedules.md`

Baseline: `2d09045`

Implementation head: `4e61006`

Status: implementation clear; product Stage 2 remains open only at the separately authorized human gates listed below. Stage 3 is unstarted.

## Implementation

| Task | Status | Commits |
|---|---|---|
| Plan checkpoint | clear | `a0b685d` |
| Scheduler ownership capability | clear | `86517f9` |
| Flow and schedule state | clear | `bd3d03f` |
| YAML record editing | clear | `d124312` |
| Live-only OSC 52 forwarding | clear | `1930794` |
| Flow and action library | clear | `27d5e80` |
| Flow run controls | clear | `9f70c08` |
| Schedule management | clear | `3a296ef` |
| App integration | clear | `49c0c05` |
| Validation and Level 1 fixes | clear | `563c7ab`, `9f47ceb`, `866d3fe`, `4e61006` |

The implementation adds owner-aware flow/action libraries, retained run state and controls, flow inputs, standalone action launch, project-filtered schedules, scheduler-owner capability enforcement, strict YAML editing through `$EDITOR`, and bounded live-only OSC 52 forwarding. Existing live-session bridges, reconnect handling, focus routing, and disposal remain in place.

## Level 1 review

Active level: Level 1 — Standard review.

Verdict: `Clear`.

The broad pass covered the plan diff and directly affected backend integration. It found and fixed five material issues before the verdict:

1. flow-input keystrokes were consumed before reaching the input renderable;
2. an unrelated owner's run event could invalidate the selected owner's in-flight load;
3. scheduler ownership was not refreshed after reconnect;
4. master flow editing could reference project-scoped actions, and the new schedule draft used backend-invalid rate syntax;
5. owner switching could briefly leave the previous project's product rows actionable.

The verification-only pass over those fixes found no remaining Level 1 defect. No optional hardening work was added.

## Automated validation

Final results at `4e61006`:

- backend scheduler capability: 2 passed;
- editor, flow, and schedule focused tests: 29 passed;
- session and OpenTUI focused tests: 96 passed;
- complete TUI package: 219 passed;
- repository lint: passed;
- repository typecheck: passed;
- backend compiled binary: passed;
- TUI compiled binary: passed;
- `git diff --check`: passed.

The full repository run completed with 1,096 passed and 9 failed. All nine failures are suite-order pollution outside this plan:

- one `wiki-backend-collision.repro.test.ts` failure from leaked wiki-store roots;
- three `MarkdownPaneImpl.anchors.test.tsx` failures and five `MarkdownPaneImpl.checkbox.test.tsx` failures because an earlier module mock replaces `useSessionStore`.

The same wiki assertion was reproduced on baseline `2d09045`. The nine affected tests pass together in isolation. The eight Markdown pane failures are also recorded as pre-existing in the Stage 1 handoff. No unrelated suite-pollution fix was folded into Stage 2.

## Isolated shell smoke

The development smoke used a new absolute config root and the unique branch `stage2-smoke-20260825`, with the production backend left running. No provider-backed process was launched.

Verified:

- global and project flow/action YAML create and edit;
- renderer suspend, external-editor exit, resume, and clean terminal restoration;
- a standalone shell action printed the expected `global-stage2` marker in its selected tab;
- a one-step project shell flow opened its run screen and completed after skip;
- text and filepath inputs were collected and persisted as `hello-stage2` and `/tmp/input.txt`;
- definitions and completed run evidence survived an isolated backend restart;
- the development schedule screen displayed the exact read-only ownership banner and ignored mutation keys;
- isolated records stayed under the temporary root. No production project, task, flow, run, schedule, session-log, theme, notification, or settings record changed. The concurrently running production backend refreshed only its generated agent-skill cache files.

The scheduler-owner smoke used a second empty absolute config root with no development branch. It created a fixture project and a schedule with `enabled: false`, `lastRunAt: null`, and `nextRunAt: null`, then edited it while keeping it disabled, deleted it, and verified an empty final list. It was never enabled or triggered.

All temporary smoke roots were moved to Trash after verification.

## Outstanding human gates

These remain separate approval gates and were not run:

- one provider-backed agent flow with pause/resume as applicable;
- one manual disabled-schedule trigger and session lifecycle check;
- the deferred remote/SSH smoke from the earlier stage.

The implementation is ready for those gates. Stage 3 remains unstarted in this
handoff's implementation history.

## User Ghostty checkpoint

On 2026-08-25 the user first launched the TUI in Ghostty and confirmed basic
launch, rendering, and exit. The user later ran the prescribed direct PTY
resize, application-cursor, and child-terminal wheel checks and reported that
all three passed. The user also created multiple sessions, switched between
them, closed sessions, and opened replacements successfully. Provider-backed
restart and resume also worked. The narrower live-session terminal gate and the
live-session agent resume gate are closed.

The user later ran the OSC 52 clipboard check after the OSC 1 frame-corruption
fix. The marker and clipboard restoration both passed, so the OSC 52 gate is
closed.
