## 1. Area summary

**Yes, chiefly scheduling and discovery improvements.**

Taskflow builds CLI-specific commands, launches PTYs, persists terminal output, and resumes native sessions using saved IDs and account homes. See [session-lifecycle.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/session-lifecycle.ts:384), [agent-accounts.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/agent-accounts.ts:52), and [native-session-discovery.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/native-session-discovery.ts:47).

Its schedules launch sessions and await explicit completion; the tray infers attention after three seconds without output. See [scheduler-service.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/scheduler-service.ts:144) and [tray-state-tracker.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/tray-state-tracker.ts:15).

t3code obtains lifecycle and history through protocols or SDKs. Its transferable pieces are scheduling rules, discovery probes, Git checkpoint mechanics, and a separate resource-monitor process.

## 2. Recommendations

1. **Reserve scheduled runs before awaiting spawn. Effort S; reimplement the pattern.**  
   Taskflow checks `runningSessions`, awaits `spawnSession`, then registers the result. I reproduced two concurrent `triggerNow` calls spawning **two sessions** using in-memory dependencies, without launching agents. t3code’s [ScheduledTaskService.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/scheduledTasks/ScheduledTaskService.ts:756) reserves the schedule synchronously before asynchronous work and releases that reservation on completion or failure. Add equivalent admission control around Taskflow’s execution path. This fits PTY scheduling directly and needs no Effect dependencies.

2. **Preserve due times and define missed-run behavior. Effort M; reimplement semantics.**  
   Taskflow’s [computeNextRun](/Users/kuindji/Projects/taskflow/packages/backend/src/services/scheduler-service.ts:43) calculates cron occurrences from now, while rates use the last start time. Restart/reconnect therefore skips missed cron occurrences but immediately runs overdue rates. Unrelated edits also reschedule through `onScheduleUpdated`.  
   t3code preserves `next_run_at` when schedule/enabled fields are unchanged in [ScheduledTaskService.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/scheduledTasks/ScheduledTaskService.ts:1151), and [Schedule.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/scheduledTasks/Schedule.ts:64) permits fixed-time catch-up within ten minutes. Borrow the explicit policy and preserved due time, while choosing Taskflow’s own grace period and retaining cron-parser.

3. **Make discovery account-aware, complete, and model-specific. Effort M; port small algorithms.**  
   Taskflow’s [runtime-detector.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/runtime-detector.ts:159) probes Codex with the backend environment and requests one model page, although launches can select another account. t3code’s [CodexProvider.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/provider/CodexProvider.ts:353) follows `nextCursor`, applies the selected home/environment, and reads `account/read`. Reuse those techniques for selected-account model lists and read-only auth diagnostics.  
   Also borrow Pi’s [thinkingCapabilities.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/packages/provider-pi/src/server/thinkingCapabilities.ts:24): extended thinking levels require model opt-in. Taskflow’s [PiOptions.tsx](/Users/kuindji/Projects/taskflow/packages/ui/src/components/shared/PiOptions.tsx:47) offers `xhigh` globally. Discovery-only protocol probes fit the existing approach; session control stays in PTYs. Keep each CLI’s actual flags and version constraints authoritative.

4. **Add optional process-tree resource diagnostics. Effort M; copy the Rust helper selectively, reimplement integration.**  
   t3code’s [native/resource-monitor/src/main.rs](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/native/resource-monitor/src/main.rs:354) samples CPU, memory, and I/O, tracks PID/start-time identity, and bounds history. [NativeTelemetryClient.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/resourceTelemetry/NativeTelemetryClient.ts:262) stops periodic sampling without subscribers.  
   Taskflow’s [pty-manager.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/pty-manager.ts:306) retains terminal operations but exposes no PID attribution. Exposing session root PIDs would support backend-local diagnostics, including remote backends. Useful for finding runaway agents or tools; CPU consumption cannot prove busy/idle/waiting state.

5. **Consider explicit task or flow checkpoints. Effort L; reimplement using t3code’s Git techniques.**  
   Taskflow’s [GitService.revertFile](/Users/kuindji/Projects/taskflow/packages/backend/src/services/git-service.ts:395) restores HEAD, so it cannot recover a dirty workspace’s pre-agent contents. t3code’s [GitVcsDriver.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/vcs/GitVcsDriver.ts:852) captures through a temporary index, `write-tree`, `commit-tree`, and private refs. Borrow its split-index precautions and [restore isolation checks](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts:12). Explicit snapshots fit Taskflow; automatic per-turn undo lacks reliable PTY boundaries. Multiple sessions within one task also require restore exclusion.

## 3. Considered and rejected

- **Native history implementation:** no ready JSONL reader worth copying. [claudeHistoryWorker.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/apps/server/src/claudeHistoryWorker.ts:1) delegates to Claude’s SDK. Pi reads protocol entries. One useful warning from its [adapter.ts](/private/tmp/claude-501/-Users-kuindji-Projects-taskflow/a90ec5a2-57b9-413a-872d-9cafb1dba92a/scratchpad/src/t3code/packages/provider-pi/src/server/adapter.ts:1422): follow active-leaf ancestry, because append order includes abandoned branches.
- **Protocol lifecycle, unified model options, orchestration-v2:** tightly coupled to owned turns and chat rendering. They do not solve PTY status detection without changing Taskflow’s architecture.
- **Secret-provider framework:** no demonstrated need beyond existing CLI-owned credentials. Its additional configuration and unlock lifecycle are unjustified here.
- **Process-group stopping:** Taskflow already has PID-reuse checks and tree stopping in [process-stopper.ts](/Users/kuindji/Projects/taskflow/packages/backend/src/services/process-stopper.ts:227); no clear replacement benefit.

## 4. Uncertainties

CLI/version compatibility, real-account auth behavior, resource overhead, and checkpoint restoration were not exercised. Findings otherwise come from current source inspection; only the scheduler overlap received an executable reproduction. No files were modified.

