import Foundation

/// Hand-written model for `FlowRun` from `packages/shared/src/types/flow.ts`.
///
/// The codegen emits `FlowRunsListResponse.runs: [AnyCodable]` because the TS source is a
/// discriminated-union intersection (`FlowOwner & { ... }`) that the generator cannot flatten.
/// This file provides the concrete Swift representation.
///
/// JSON layout: exactly one of `taskId`, `projectId`, or `master` is present (mirrors `FlowOwner`).
struct FlowRun: Codable, Sendable, Equatable {
    let taskId: String?
    let projectId: String?
    let master: Bool?
    let flowId: String
    let status: FlowRunStatus
    let currentActionIndex: Double
    let actions: [FlowActionState]
    let artifacts: [FlowArtifact]
    let inputValues: [String: String]?
    let startedAt: String
    let completedAt: String?

    /// Mirrors `getFlowRunOwnerId` from `packages/shared/src/types/flow.ts`.
    /// Returns taskId if set, projectId if set, or `"__master__"` if master is true.
    ///
    /// Returns `nil` for the impossible no-owner case rather than crashing. `FlowRun` is decoded
    /// from untrusted WebSocket input (`flow:run-updated` events, `flow:runs-list` responses);
    /// the TS `getFlowRunOwnerId` `throw` is catchable — an uncaught throw in a JS WS handler logs
    /// and skips that one run without crashing the app. A trap (`preconditionFailure`/`fatalError`)
    /// would turn malformed input into an unrecoverable app abort (DoS), so callers must instead
    /// skip nil-owner runs.
    func ownerId() -> String? {
        if let taskId { return taskId }
        if let projectId { return projectId }
        if master == true { return "__master__" }
        return nil
    }
}
