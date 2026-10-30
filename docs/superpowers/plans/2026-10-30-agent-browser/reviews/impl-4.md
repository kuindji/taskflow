Changes required. Worker discovery can stall the CDP stream and break create-target reply ordering. The 68 new tests and backend typecheck pass, but do not cover this scenario.

Review comment:

- [P2] Skip ownership waits for browser-level worker targets — /Users/kuindji/Projects/taskflow/packages/backend/src/services/cdp/cdp-filter.ts:141-144
  When sites have active service workers, Puppeteer's all-target discovery emits targets that the tab registry can never resolve. Each nevertheless incurs `resolveTarget`'s full 2000 ms wait, blocking the entire ordered upstream stream. Using the real service resolver, four worker events delayed a normal reply by 8003 ms. Two events also caused `Target.createTarget` to reply at 2001 ms before the queued page attach arrived at 4002 ms, defeating the required attach-before-reply ordering. Reject browser-level target types other than page/tab before waiting for registry ownership, while preserving nested worker attachments under allowed sessions.
