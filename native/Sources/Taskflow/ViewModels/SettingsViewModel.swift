import Foundation
import Observation

/// Wire type for the data-directory info returned by `settings:get-data-dir` /
/// `settings:update-data-dir`. Defined here because it is not emitted by codegen
/// (the TS `DataDirInfo` interface lives locally in `settings-store.ts`, not in
/// `@taskflow/shared`).
struct DataDirInfo: Codable, Sendable, Equatable {
    let dataDir: String
    let baseDir: String
    let isDefault: Bool
    let conflict: Bool?
}

/// Typed mode parameter for `updateDataDir`, matching the TS `"overwrite" | "adopt"` union.
enum DataDirMode: String, Codable, Sendable {
    case overwrite
    case adopt
}

/// 1:1 port of `packages/ui/src/stores/settings-store.ts`.
///
/// Behavioral notes:
/// - `load()` maps to `fetchSettings` in the TS store: fetches `AppSettings`, stores them,
///   and calls `onLayoutHydrate?(settings.layout.panels)` where the TS calls
///   `useUIStore.getState().hydrateLayout(settings.layout.panels)`.
/// - `updateSettings(_:)` sends a partial update dict and stores the returned `AppSettings`.
///   The TS also conditionally calls `sendConfirmBeforeExitState`; that Electron-IPC call
///   has no native equivalent and is omitted.
/// - `fetchDataDir` / `updateDataDir` are standalone actions with no WS subscriptions.
/// - The settings-store.ts has no WS event subscriptions, so there is no `bind()` method.
/// - Cross-store dependency (`useUIStore.hydrateLayout`) is modelled as
///   `onLayoutHydrate: ((PanelSettings) -> Void)?`; wired in Task 8.
///   (`PanelSettings` is the generated name for what the brief calls `LayoutPanels`.)
@MainActor
@Observable
final class SettingsViewModel {
    private(set) var settings: AppSettings?
    private(set) var dataDirInfo: DataDirInfo?

    /// Injected closure: invoked after a settings fetch when `layout.panels` is present.
    /// Wired in Task 8 to `UIViewModel.hydrateLayout(_:)`.
    var onLayoutHydrate: ((PanelSettings) -> Void)?

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Load (fetchSettings equivalent)

    /// Fetches `AppSettings`, stores them, and fires `onLayoutHydrate` with the panel config.
    /// Called once by `AppEnvironment.boot()`.
    func load() async {
        do {
            let fetched: AppSettings = try await client.request(.settingsGet, payload: [:])
            applyFetchedSettings(fetched)
        } catch {
            // Non-fatal: a missing/malformed field (e.g. non-optional PanelSettings key absent
            // from older persisted JSON) must not abort boot. Log and continue.
            NSLog("[SettingsViewModel] load failed (non-fatal): \(error)")
        }
    }

    // MARK: - Actions

    /// Applies `partial` settings patch and updates the stored `AppSettings`.
    /// Patch format mirrors `SettingsUpdatePayload` field names but uses `[String: Any]`
    /// because callers typically supply a single-key dict (e.g. `["general": [...]]`),
    /// matching the WSClient's wire-payload type.
    func updateSettings(_ patch: [String: Any]) async {
        do {
            let updated: AppSettings = try await client.request(.settingsUpdate, payload: patch)
            settings = updated
        } catch {}
    }

    /// Fetches current data-directory information and stores it.
    func fetchDataDir() async {
        do {
            let info: DataDirInfo = try await client.request(.settingsGetDataDir, payload: [:])
            dataDirInfo = info
        } catch {}
    }

    /// Updates the data directory; stores the result unless a conflict is reported.
    @discardableResult
    func updateDataDir(path: String, mode: DataDirMode? = nil) async throws -> DataDirInfo {
        var payload: [String: Any] = ["path": path]
        if let mode { payload["mode"] = mode.rawValue }
        let info: DataDirInfo = try await client.request(.settingsUpdateDataDir, payload: payload)
        if info.conflict != true {
            dataDirInfo = info
        }
        return info
    }

    // MARK: - Internal apply (testable without a live socket)

    /// Stores `settings` and fires `onLayoutHydrate` with the panel config.
    /// Called from `load()` after the RPC completes; exposed as `internal` so unit tests
    /// can exercise the apply path without a real WebSocket connection.
    func applyFetchedSettings(_ fetched: AppSettings) {
        settings = fetched
        onLayoutHydrate?(fetched.layout.panels)
    }
}
