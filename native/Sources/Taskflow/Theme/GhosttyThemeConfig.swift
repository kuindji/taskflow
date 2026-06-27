import Foundation

// Maps a resolved theme's terminal colors to libghostty config key/value pairs.
// Wired into the terminal surface in Phase 4; unit-tested here as a pure mapping.
enum GhosttyThemeConfig {
    static func pairs(from file: ResolvedThemeFile) -> [(String, String)] {
        let x = file.xterm
        var out: [(String, String)] = [
            ("background", x.background),
            ("foreground", x.foreground),
            ("cursor-color", x.cursor),
            ("selection-background", x.selectionBackground),
        ]
        let palette = [
            x.black, x.red, x.green, x.yellow, x.blue, x.magenta, x.cyan, x.white,
            x.brightBlack, x.brightRed, x.brightGreen, x.brightYellow,
            x.brightBlue, x.brightMagenta, x.brightCyan, x.brightWhite,
        ]
        for (i, hex) in palette.enumerated() {
            out.append(("palette", "\(i)=\(hex)"))
        }
        return out
    }
}
