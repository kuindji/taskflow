import Foundation
import Observation

// Theme list for the Appearance grid. Port of theme-store.ts (bundled subset for 5E).
// Activation drives the live ThemeStore + persists appearance.theme (imported themes deferred).
@MainActor @Observable
final class ThemeCatalogViewModel {
    private(set) var themes: [ThemeRecord] = []
    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    nonisolated static func bundled(_ records: [ThemeRecord]) -> [ThemeRecord] {
        records.filter { $0.source.origin == .bundled }
    }

    nonisolated static func resolveActiveId(settingsTheme: String?, available: [ThemeRecord], fallback: String) -> String {
        if let t = settingsTheme, available.contains(where: { $0.id == t }) { return t }
        return fallback
    }

    func load() async {
        if let r: ThemeListResponse = try? await client.request(.themeList, payload: [:]) {
            themes = Self.bundled(r.themes)
        }
    }

    func activate(_ id: String, themeStore: ThemeStore, settings: SettingsViewModel?) async {
        themeStore.select(id: id)
        await settings?.updateSettings(SettingsPatch(appearance: AppearancePatch(theme: id)))
    }
}
