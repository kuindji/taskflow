import SwiftUI
import GhosttyTerminal

struct TerminalPane: NSViewRepresentable {
    let workingDirectory: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var state: TerminalViewState?
    }

    func makeNSView(context: Context) -> NSView {
        let bootScript = """
        echo '── native-slice: libghostty .exec surface live ──'; \
        command -v claude >/dev/null && exec claude || exec /bin/zsh -l
        """
        let command = "/bin/zsh -lc \"\(bootScript.replacingOccurrences(of: "\"", with: "\\\""))\""
        let config = TerminalConfiguration(startingFrom: .default) { builder in
            builder.withCustom("command", command)
            builder.withFontSize(14)
        }
        let state = TerminalViewState(configSource: .generated(config.rendered))
        context.coordinator.state = state

        let terminal = TerminalView(frame: .zero)
        terminal.delegate = state
        terminal.controller = state.controller
        terminal.configuration = TerminalSurfaceOptions(backend: .exec, workingDirectory: workingDirectory)
        return terminal
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
