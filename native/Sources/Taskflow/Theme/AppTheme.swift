import SwiftUI

// All 43 CSS variable names from packages/shared/src/types/theme.ts CssVariables interface.
enum ThemeToken: String {
    case background = "--background"
    case foreground = "--foreground"
    case card = "--card"
    case cardForeground = "--card-foreground"
    case popover = "--popover"
    case popoverForeground = "--popover-foreground"
    case primary = "--primary"
    case primaryForeground = "--primary-foreground"
    case secondary = "--secondary"
    case secondaryForeground = "--secondary-foreground"
    case accent = "--accent"
    case accentForeground = "--accent-foreground"
    case muted = "--muted"
    case mutedForeground = "--muted-foreground"
    case destructive = "--destructive"
    case destructiveForeground = "--destructive-foreground"
    case success = "--success"
    case successForeground = "--success-foreground"
    case warning = "--warning"
    case warningForeground = "--warning-foreground"
    case info = "--info"
    case infoForeground = "--info-foreground"
    case cursorAgent = "--cursor-agent"
    case cursorAgentForeground = "--cursor-agent-foreground"
    case border = "--border"
    case input = "--input"
    case ring = "--ring"
    // --island-base emits rgba(...) format; Color(hex:) handles it via rgba parse branch.
    case islandBase = "--island-base"
    case dialogShell = "--dialog-shell"
    case windowShellFullscreen = "--window-shell-fullscreen"
    case chart1 = "--chart-1"
    case chart2 = "--chart-2"
    case chart3 = "--chart-3"
    case chart4 = "--chart-4"
    case chart5 = "--chart-5"
    case sidebarBackground = "--sidebar-background"
    case sidebarForeground = "--sidebar-foreground"
    case sidebarPrimary = "--sidebar-primary"
    case sidebarPrimaryForeground = "--sidebar-primary-foreground"
    case sidebarAccent = "--sidebar-accent"
    case sidebarAccentForeground = "--sidebar-accent-foreground"
    case sidebarBorder = "--sidebar-border"
    case sidebarRing = "--sidebar-ring"
}

struct AppTheme: Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    private let css: [String: String]

    init(_ file: ResolvedThemeFile) {
        id = file.id
        name = file.name
        css = file.css
    }

    private init(id: String, name: String, css: [String: String]) {
        self.id = id
        self.name = name
        self.css = css
    }

    // Used when no theme files could be loaded (e.g. bundle misconfiguration).
    // hex() falls back to "#000000" for missing keys so colours degrade gracefully.
    static let fallback = AppTheme(id: "fallback", name: "Fallback", css: [:])

    func hex(_ token: ThemeToken) -> String { css[token.rawValue] ?? "#000000" }
    func color(_ token: ThemeToken) -> Color { Color(hex: hex(token)) }

    var background: Color { color(.background) }
    var foreground: Color { color(.foreground) }
    var primary: Color { color(.primary) }
    var accent: Color { color(.accent) }
    var border: Color { color(.border) }
    var muted: Color { color(.muted) }
    var destructive: Color { color(.destructive) }
    var success: Color { color(.success) }
    var warning: Color { color(.warning) }
}

extension Color {
    // Parses hex (#RRGGBB, #RRGGBBAA) and rgba(r, g, b, a) values.
    // Unrecognised formats (including 3-char #RGB) fall back to opaque black rather than crashing.
    init(hex: String) {
        // rgba(r, g, b, a) — e.g. produced by --island-base in derived themes
        if hex.hasPrefix("rgba(") || hex.hasPrefix("RGBA(") {
            let inner = String(hex.dropFirst(5).dropLast())
            let parts = inner.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 4,
               let r = Double(parts[0]),
               let g = Double(parts[1]),
               let b = Double(parts[2]),
               let a = Double(parts[3]) {
                self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: a)
                return
            }
            self.init(.sRGB, red: 0, green: 0, blue: 0, opacity: 1)
            return
        }
        // rgb(r, g, b) fallback
        if hex.hasPrefix("rgb(") || hex.hasPrefix("RGB(") {
            let inner = String(hex.dropFirst(4).dropLast())
            let parts = inner.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 3,
               let r = Double(parts[0]),
               let g = Double(parts[1]),
               let b = Double(parts[2]) {
                self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: 1)
                return
            }
            self.init(.sRGB, red: 0, green: 0, blue: 0, opacity: 1)
            return
        }
        // Hex: #RRGGBB, #RRGGBBAA (3-char #RGB is not supported)
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        let r, g, b, a: Double
        if h.count == 8 {
            r = Double((v >> 24) & 0xFF) / 255
            g = Double((v >> 16) & 0xFF) / 255
            b = Double((v >> 8) & 0xFF) / 255
            a = Double(v & 0xFF) / 255
        } else {
            r = Double((v >> 16) & 0xFF) / 255
            g = Double((v >> 8) & 0xFF) / 255
            b = Double(v & 0xFF) / 255
            a = 1
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}
