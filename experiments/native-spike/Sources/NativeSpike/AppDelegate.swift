//
//  AppDelegate.swift
//  NativeSpike
//
//  Phase 1 + 2 of the spike:
//   - Embed a libghostty GPU terminal (AppTerminalView) as one subview in a
//     normal AppKit window with a header bar above it.
//   - Use the `.exec` backend so libghostty owns the PTY and spawns a real
//     process (matches viability decision D4 for live interactive sessions).
//   - The spawned shell logs to the Taskflow backend via taskflow-cli and then
//     launches `claude`, proving the agent's CLI calls still reach the backend
//     over WS regardless of where the PTY lives.
//
//  The spawned process inherits this app's environment, which — because the app
//  is launched from inside a Taskflow session — already carries TASKFLOW_API_URL,
//  TASKFLOW_SESSION_ID and TASKFLOW_TASK_ID. That is exactly the env the backend
//  injects when it owns the PTY (session-lifecycle.ts), so the CLI contract holds.
//

import AppKit
import GhosttyTerminal

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var terminalState: TerminalViewState!
    private var watch: BackendWatch!

    func applicationDidFinishLaunching(_: Notification) {
        // NATIVE_SPIKE_MODE=watch  → Phase 3: render a backend-owned session's
        //   WS byte stream through a libghostty `.inMemory` surface (Risk 3).
        // anything else (default)  → Phase 1+2: `.exec`, libghostty owns the PTY.
        if ProcessInfo.processInfo.environment["NATIVE_SPIKE_MODE"] == "watch" {
            startWatchMode()
            return
        }
        startExecMode()
    }

    // MARK: - Phase 1+2: interactive `.exec` surface

    private func startExecMode() {
        let repoRoot = repoRootPath()

        // The command libghostty will spawn inside the embedded surface.
        // Logs a marker to the Taskflow backend, prints proof, then drops into
        // an interactive claude (falling back to a shell if claude is absent).
        let bootScript = """
        echo '── native-spike: libghostty .exec surface live ──'; \
        echo "TASKFLOW_API_URL=$TASKFLOW_API_URL"; \
        echo "TASKFLOW_TASK_ID=$TASKFLOW_TASK_ID"; \
        taskflow-cli log info 'native-spike: hello from inside the libghostty .exec terminal' \
          && echo '✓ taskflow-cli reached the backend over WS' \
          || echo '✗ taskflow-cli failed to reach the backend'; \
        echo; echo 'launching claude…'; \
        command -v claude >/dev/null && exec claude || exec /bin/zsh -l
        """
        let command = "/bin/zsh -lc \"\(bootScript.replacingOccurrences(of: "\"", with: "\\\""))\""

        let config = TerminalConfiguration(startingFrom: .default) { builder in
            builder.withCustom("command", command)
            builder.withFontSize(14)
        }

        terminalState = TerminalViewState(configSource: .generated(config.rendered))

        let terminal = TerminalView(frame: .zero)
        terminal.delegate = terminalState
        terminal.controller = terminalState.controller
        terminal.configuration = TerminalSurfaceOptions(
            backend: .exec,
            workingDirectory: repoRoot
        )
        terminal.translatesAutoresizingMaskIntoConstraints = false

        // Header bar to make clear this is a normal app window hosting the
        // terminal as one component, not a terminal-first app.
        let header = makeHeader("● Live session — GPU terminal rendered by libghostty, hosted in AppKit")

        let content = NSView()
        content.addSubview(header)
        content.addSubview(terminal)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),

            terminal.topAnchor.constraint(equalTo: header.bottomAnchor),
            terminal.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            terminal.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Taskflow Native Spike — embedded libghostty"
        window.contentView = content
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(terminal)

        NSApp.activate(ignoringOtherApps: true)
    }

    // MARK: - Phase 3: watch a backend-owned session via `.inMemory` (Risk 3)

    private func startWatchMode() {
        let env = ProcessInfo.processInfo.environment
        let apiURL = env["TASKFLOW_API_URL"] ?? "http://localhost:63074"
        // Watch this very agent's backend-owned PTY session by default.
        let sessionID = env["NATIVE_SPIKE_WATCH_SESSION"]
            ?? env["TASKFLOW_SESSION_ID"]
            ?? ""

        // The in-memory backend: libghostty renders bytes we feed via receive();
        // its `write` callback carries keystrokes typed into THIS surface, and
        // `resize` reports the grid size — both forwarded to the backend PTY.
        var watchRef: BackendWatch?
        let session = InMemoryTerminalSession(
            write: { data in
                Task { @MainActor in watchRef?.sendInput(data) }
            },
            resize: { viewport in
                Task { @MainActor in
                    watchRef?.sendResize(columns: Int(viewport.columns), rows: Int(viewport.rows))
                }
            }
        )

        let watch = BackendWatch(apiURL: apiURL, sessionID: sessionID, session: session)
        watchRef = watch
        self.watch = watch

        let terminal = TerminalView(frame: .zero)
        terminalState = TerminalViewState(configSource: .none)
        terminal.delegate = terminalState
        terminal.controller = terminalState.controller
        terminal.configuration = TerminalSurfaceOptions(backend: .inMemory(session))
        terminal.translatesAutoresizingMaskIntoConstraints = false

        let header = makeHeader(
            "◉ WATCHING backend-owned session \(sessionID.prefix(8))… — WS byte stream → libghostty .inMemory surface"
        )

        let content = NSView()
        content.addSubview(header)
        content.addSubview(terminal)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: content.topAnchor),
            header.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            header.heightAnchor.constraint(equalToConstant: 44),

            terminal.topAnchor.constraint(equalTo: header.bottomAnchor),
            terminal.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            terminal.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            terminal.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 960, height: 640),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Taskflow Native Spike — watching a backend session (.inMemory)"
        window.contentView = content
        window.center()
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(terminal)
        NSApp.activate(ignoringOtherApps: true)

        // Surface is created when the view attaches to the window (above); give
        // it a beat, then connect and pull the snapshot + live stream.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            watch.start()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_: NSApplication) -> Bool {
        true
    }

    private func makeHeader(_ text: String) -> NSView {
        let header = NSView()
        header.translatesAutoresizingMaskIntoConstraints = false
        header.wantsLayer = true
        header.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let label = NSTextField(labelWithString: text)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.font = .systemFont(ofSize: 12, weight: .medium)
        label.textColor = .secondaryLabelColor
        header.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 14),
            label.centerYAnchor.constraint(equalTo: header.centerYAnchor),
        ])
        return header
    }

    /// Walk up from the executable to the repo root (the worktree dir).
    private func repoRootPath() -> String {
        // experiments/native-spike is two levels under the worktree root.
        let cwd = FileManager.default.currentDirectoryPath
        return cwd
    }
}
