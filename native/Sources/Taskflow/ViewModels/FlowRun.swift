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
    func ownerId() -> String {
        if let taskId { return taskId }
        if let projectId { return projectId }
        if master == true { return "__master__" }
        // Mirrors TS `getFlowRunOwnerId` which throws here — exactly one owner must be set.
        preconditionFailure("FlowRun must have taskId, projectId, or master")
    }
}
