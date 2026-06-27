import AppKit
import GhosttyTerminal

/// Keeps each backend session's libghostty surface alive across tab switches so
/// re-selecting a tab does not re-snapshot. Carry-forward from Phase 3.
@MainActor
final class TerminalSurfaceCache {
    private struct Entry {
        let view: AppTerminalView
        let state: TerminalViewState
        let bridge: TerminalSessionBridge
    }

    private var entries: [String: Entry] = [:]

    /// Returns (or creates) the cached `AppTerminalView` for `sessionId`.
    ///
    /// The `session` parameter is a weak handle to the `SessionViewModel`; the
    /// `InMemoryTerminalSession` write/resize closures route all terminal input
    /// through it so that `markInteraction` and `lastTerminalSize` are always
    /// updated.  Passing `nil` (e.g. in a test stub) silently drops input — the
    /// output stream and history load still work normally via the bridge.
    func surface(
        for sessionId: String,
        client: WSClient,
        theme: ResolvedThemeFile,
        session: SessionViewModel?
    ) -> AppTerminalView {
        if let e = entries[sessionId] { return e.view }

        // Input routing: write/resize closures call into SessionViewModel so that
        // markInteraction() and lastTerminalSize are updated on every keystroke/resize.
        // session is captured weakly to avoid a retain cycle:
        //   Entry.bridge → bridge → inMemSession → closures → session (weak) → VM owned by AppEnvironment.
        let inMemSession = InMemoryTerminalSession(
            write: { [weak session] data in
                Task { @MainActor in
                    guard let text = String(data: data, encoding: .utf8) else { return }
                    session?.sendInput(sessionId: sessionId, data: text)
                }
            },
            resize: { [weak session] viewport in
                Task { @MainActor in
                    session?.resizeTerminal(
                        sessionId: sessionId,
                        cols: Int(viewport.columns),
                        rows: Int(viewport.rows)
                    )
                }
            }
        )

        // Bridge is OUTPUT-ONLY after this change: it subscribes to terminal:output and
        // feeds inMemSession.receive(_:), and loads the initial snapshot.  It no longer
        // owns sendInput/resize — those now live in SessionViewModel.
        let bridge = TerminalSessionBridge(sessionId: sessionId, client: client, session: inMemSession)

        // Apply theme as generated config alongside the .inMemory backend.
        // Caveat 1 (palette de-dup): withCustom appends to a [TerminalConfigCommand] array;
        // config.rendered joins all entries, so all 16 "palette = N=hex" lines survive at
        // the Swift level. Whether the libghostty C parser honours repeated palette keys is
        // verified via the DEBUG log below — if only the last survives in practice, this is
        // a known Phase-4 limitation (background/foreground/cursor/selection still apply).
        // Caveat 2 (.inMemory + generated config): the spike used configSource: .none.
        // If libghostty ignores the generated config for the host-managed backend, colours
        // will render with libghostty defaults; the live stream still works. Known limitation.
        let config = TerminalConfiguration(startingFrom: .default) { builder in
            for (key, value) in GhosttyThemeConfig.pairs(from: theme) {
                builder.withCustom(key, value)
            }
        }

        #if DEBUG
        NSLog("[TerminalSurfaceCache] config.rendered for session %@:\n%@",
              sessionId, config.rendered)
        #endif

        let state = TerminalViewState(configSource: .generated(config.rendered))
        let view = AppTerminalView(frame: .zero)
        view.delegate = state
        view.controller = state.controller
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(inMemSession))

        bridge.start()
        entries[sessionId] = Entry(view: view, state: state, bridge: bridge)
        return view
    }

    func evict(_ sessionId: String) {
        entries[sessionId]?.bridge.stop()
        entries.removeValue(forKey: sessionId)
    }
}
