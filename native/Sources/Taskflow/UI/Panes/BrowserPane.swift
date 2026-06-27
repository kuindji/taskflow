import SwiftUI
import WebKit

struct BrowserPane: NSViewRepresentable {
    let url: String

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        load(url, into: view, context.coordinator)
        return view
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url { load(url, into: nsView, context.coordinator) }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var lastURL: String? }

    private func load(_ s: String, into view: WKWebView, _ coordinator: Coordinator) {
        guard let u = URL(string: s) else { return }
        coordinator.lastURL = s          // record so we don't reload on every redraw
        view.load(URLRequest(url: u))
    }
}
