import Foundation
import Observation

// Lazy fetch + in-memory cache of agent model lists. Port of the per-popover fetch in
// packages/ui/src/components/settings/{Cursor,OpenCode,Pi}ModelSelect.tsx — fetch once,
// cache, set `failed` on error to drive the text-input fallback. No server-side caching.
@MainActor @Observable
final class ModelListViewModel {
    private(set) var cursor: [CursorModel] = []
    private(set) var opencode: [OpenCodeModelInfo] = []
    private(set) var pi: [PiModelInfo] = []
    private(set) var cursorLoaded = false
    private(set) var opencodeLoaded = false
    private(set) var piLoaded = false
    private(set) var cursorLoading = false
    private(set) var opencodeLoading = false
    private(set) var piLoading = false
    private(set) var cursorFailed = false
    private(set) var opencodeFailed = false
    private(set) var piFailed = false

    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    nonisolated static func applyCursor(_ r: CursorModelsResponse) -> [CursorModel] { r.models }
    nonisolated static func applyOpenCode(_ r: OpenCodeModelsResponse) -> [OpenCodeModelInfo] { r.models }
    nonisolated static func applyPi(_ r: PiModelsResponse) -> [PiModelInfo] { r.models }

    func ensureCursor() async {
        guard !cursorLoaded, !cursorLoading else { return }
        cursorLoading = true
        defer { cursorLoading = false; cursorLoaded = true }
        do {
            let r: CursorModelsResponse = try await client.request(.cursorModels, payload: [:])
            cursor = Self.applyCursor(r)
            cursorFailed = cursor.isEmpty
        } catch {
            cursorFailed = true
        }
    }

    func ensureOpenCode() async {
        guard !opencodeLoaded, !opencodeLoading else { return }
        opencodeLoading = true
        defer { opencodeLoading = false; opencodeLoaded = true }
        do {
            let r: OpenCodeModelsResponse = try await client.request(.opencodeModels, payload: [:])
            opencode = Self.applyOpenCode(r)
            opencodeFailed = opencode.isEmpty
        } catch {
            opencodeFailed = true
        }
    }

    func ensurePi() async {
        guard !piLoaded, !piLoading else { return }
        piLoading = true
        defer { piLoading = false; piLoaded = true }
        do {
            let r: PiModelsResponse = try await client.request(.piModels, payload: [:])
            pi = Self.applyPi(r)
            piFailed = pi.isEmpty
        } catch {
            piFailed = true
        }
    }
}
