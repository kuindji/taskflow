import SwiftUI
import AppKit

/// Draggable divider that emits incremental pixel deltas and a drag-end signal.
/// Port of `packages/ui/src/components/ResizeHandle.tsx`.
///
/// - `orientation`: `.vertical` for a col-resize handle (between side-by-side panes);
///   `.horizontal` for a row-resize handle (between stacked panes).
/// - `onDelta`: called on every drag frame with the incremental pixel delta along the resize axis.
/// - `onEnded`: called once when the user releases the drag (mirrors `onResizeEnd` in TS).
///
/// The visual indicator (a 1-pt line) fades in on hover and stays visible while dragging,
/// matching the CSS gradient rule in `ResizeHandle.tsx`.
struct ResizeHandle: View {
    enum Orientation { case vertical, horizontal }

    let orientation: Orientation
    let onDelta: (Double) -> Void
    let onEnded: () -> Void

    @State private var isDragging = false
    @State private var isHovering = false
    @State private var lastTranslation: Double = 0

    /// 8 pt — matches the `panelGap - 3` inner gutter the TS handle occupies.
    private let thickness: Double = 8

    var body: some View {
        Color.clear
            .frame(
                width:  orientation == .vertical   ? thickness : nil,
                height: orientation == .horizontal ? thickness : nil
            )
            .contentShape(Rectangle())
            .gesture(dragGesture)
            .onHover { hovering in
                isHovering = hovering
                if orientation == .vertical {
                    hovering ? NSCursor.resizeLeftRight.push() : NSCursor.pop()
                } else {
                    hovering ? NSCursor.resizeUpDown.push() : NSCursor.pop()
                }
            }
            .overlay { indicator }
            .animation(.easeOut(duration: 0.15), value: isDragging || isHovering)
    }

    // MARK: - Drag gesture

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { value in
                let current: Double = orientation == .vertical
                    ? value.translation.width
                    : value.translation.height
                if !isDragging {
                    isDragging = true
                    lastTranslation = 0
                }
                let delta = current - lastTranslation
                lastTranslation = current
                onDelta(delta)
            }
            .onEnded { _ in
                isDragging = false
                lastTranslation = 0
                onEnded()
            }
    }

    // MARK: - Visual indicator

    @ViewBuilder
    private var indicator: some View {
        let opacity: Double = isDragging || isHovering ? 0.3 : 0
        if orientation == .vertical {
            Rectangle()
                .fill(Color.white.opacity(opacity))
                .frame(width: 1)
        } else {
            Rectangle()
                .fill(Color.white.opacity(opacity))
                .frame(height: 1)
        }
    }
}
