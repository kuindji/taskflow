import Foundation

struct XtermColors: Decodable, Sendable, Equatable {
    let background, foreground, cursor, cursorAccent, selectionBackground: String
    let black, red, green, yellow, blue, magenta, cyan, white: String
    let brightBlack, brightRed, brightGreen, brightYellow: String
    let brightBlue, brightMagenta, brightCyan, brightWhite: String
}

struct ResolvedThemeFile: Decodable, Sendable, Equatable {
    let id: String
    let name: String
    let css: [String: String]   // 43 CSS-var name -> value
    let xterm: XtermColors
}
