import SwiftUI
import UniformTypeIdentifiers

enum PaneKind: String, CaseIterable, Identifiable {
    case terminal, editor
    var id: String { rawValue }
    var title: String { self == .terminal ? "Terminal" : "Editor" }
}

struct TabStrip: View {
    @Binding var order: [PaneKind]
    @Binding var active: PaneKind

    var body: some View {
        HStack(spacing: 4) {
            ForEach(order) { kind in
                Text(kind.title)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(active == kind ? Color.accentColor.opacity(0.2) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .onTapGesture { active = kind }
                    .onDrag { NSItemProvider(object: kind.rawValue as NSString) }
                    .onDrop(of: [.text], delegate: TabDropDelegate(item: kind, order: $order))
            }
            Spacer()
        }
        .padding(6)
    }
}

private struct TabDropDelegate: DropDelegate {
    let item: PaneKind
    @Binding var order: [PaneKind]

    func dropEntered(info: DropInfo) {
        guard let from = info.itemProviders(for: [.text]).first else { return }
        from.loadObject(ofClass: NSString.self) { obj, _ in
            guard let raw = obj as? String, let dragged = PaneKind(rawValue: raw),
                  dragged != item,
                  let f = order.firstIndex(of: dragged), let t = order.firstIndex(of: item) else { return }
            DispatchQueue.main.async {
                withAnimation { order.move(fromOffsets: IndexSet(integer: f),
                                           toOffset: t > f ? t + 1 : t) }
            }
        }
    }
    func performDrop(info: DropInfo) -> Bool { true }
}
