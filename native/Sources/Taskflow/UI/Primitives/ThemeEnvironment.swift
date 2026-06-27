import SwiftUI

private struct AppThemeKey: EnvironmentKey {
    static let defaultValue = AppTheme.fallback
}

extension EnvironmentValues {
    var appTheme: AppTheme {
        get { self[AppThemeKey.self] }
        set { self[AppThemeKey.self] = newValue }
    }
}
