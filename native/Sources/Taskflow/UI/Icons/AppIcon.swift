import SwiftUI

/// Renders a lucide-react icon name as the nearest SF Symbol. Master-plan 5.9.
/// Unmapped names render a visible placeholder so coverage gaps are obvious.
struct AppIcon: View {
    private let lucide: String
    init(_ lucide: String) { self.lucide = lucide }

    var body: some View { Image(systemName: Self.symbol(forLucide: lucide)) }

    /// Pure mapping from lucide icon name to SF Symbol name.
    /// Marked nonisolated so tests can call it synchronously without actor-hopping.
    nonisolated static func symbol(forLucide name: String) -> String {
        // lucide occasionally imports `<Name>Icon`; treat as `<Name>`.
        let key = name.hasSuffix("Icon") && name != "Icon" ? String(name.dropLast(4)) : name
        switch key {
        case "Plus": return "plus"
        case "Minus": return "minus"
        case "X": return "xmark"
        case "Check": return "checkmark"
        case "ChevronDown": return "chevron.down"
        case "ChevronRight": return "chevron.right"
        case "ChevronUp": return "chevron.up"
        case "ChevronLeft": return "chevron.left"
        case "ArrowLeft": return "arrow.left"
        case "ArrowDownToLine": return "arrow.down.to.line"
        case "Bell": return "bell"
        case "Archive": return "archivebox"
        case "ArchiveRestore": return "arrow.up.bin"
        case "Trash2": return "trash"
        case "Pin": return "pin"
        case "Play": return "play.fill"
        case "Copy": return "doc.on.doc"
        case "ExternalLink": return "arrow.up.right.square"
        case "File": return "doc"
        case "FileCode": return "doc.text"
        case "FilePlus": return "doc.badge.plus"
        case "Folder": return "folder.fill"
        case "FolderOpen": return "folder"
        case "FolderPlus": return "folder.badge.plus"
        case "Filter": return "line.3.horizontal.decrease.circle"
        case "GitBranch": return "arrow.triangle.branch"
        case "GitFork": return "arrow.triangle.branch"
        case "Globe": return "globe"
        case "Info": return "info.circle"
        case "CircleHelp": return "questionmark.circle"
        case "Circle": return "circle"
        case "Loader2": return "arrow.triangle.2.circlepath"
        case "Maximize2": return "arrow.up.left.and.arrow.down.right"
        case "Monitor": return "display"
        case "MoreHorizontal": return "ellipsis"
        case "Palette": return "paintpalette"
        case "Regex": return "asterisk"
        case "Replace": return "arrow.left.arrow.right"
        case "ReplaceAll": return "arrow.left.arrow.right.square"
        case "RotateCcw": return "arrow.counterclockwise"
        case "RotateCw": return "arrow.clockwise"
        case "Undo2": return "arrow.uturn.backward"
        case "Settings2": return "gearshape"
        case "SquareTerminal": return "terminal"
        case "Terminal": return "terminal"
        case "CalendarClock": return "calendar.badge.clock"
        case "CaseSensitive": return "textformat"
        case "WholeWord": return "textformat.abc"
        case "AlertTriangle": return "exclamationmark.triangle"
        case "WifiOff": return "wifi.slash"
        case "Workflow": return "flowchart"
        case "Zap": return "bolt"
        default: return "questionmark.square.dashed"
        }
    }
}
