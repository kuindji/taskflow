import SwiftUI

/// Shows a WifiOff indicator when the backend WS is disconnected.
/// (Internet-connectivity distinction vs WS is a Phase-6 seam.)
struct OfflineIndicator: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        if !isConnected {
            AppIcon("WifiOff").font(.system(size: 13))
                .foregroundStyle(theme.color(.destructive))
                .help("No connection to backend")
        }
    }

    private var isConnected: Bool {
        if case .connected = env.status {
            return true
        } else {
            return false
        }
    }
}
