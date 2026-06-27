import SwiftUI
import WebKit

struct BrowserPane: NSViewRepresentable {
    let url: String

    func makeNSView(context: Context) -> WKWebView {
        let view = WKWebView(frame: .zero)
        load(url, into: view)
        return view
    }
    func updateNSView(_ nsView: WKWebView, context: Context) {
        if context.coordinator.lastURL != url { load(url, into: nsView) }
    }
    func makeCoordinator() -> Coordinator { Coordinator() }
    final class Coordinator { var lastURL: String? }

    private func load(_ s: String, into view: WKWebView) {
        guard let u = URL(string: s) else { return }
        view.load(URLRequest(url: u))
    }
}
