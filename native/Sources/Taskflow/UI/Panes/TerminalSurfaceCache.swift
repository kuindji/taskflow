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

    func surface(for sessionId: String, client: WSClient, theme: ResolvedThemeFile) -> AppTerminalView {
        if let e = entries[sessionId] { return e.view }

        // BridgeBox breaks the circular init dependency (session needs bridge callbacks,
        // bridge needs the session). Written once on @MainActor before start(); read only
        // inside @MainActor Tasks — no actual data race.
        let box = BridgeBox()
        let session = InMemoryTerminalSession(
            write: { data in Task { @MainActor in box.bridge?.sendInput(data) } },
            resize: { viewport in
                Task { @MainActor in
                    box.bridge?.resize(cols: Int(viewport.columns), rows: Int(viewport.rows))
                }
            }
        )
        let bridge = TerminalSessionBridge(sessionId: sessionId, client: client, session: session)
        box.bridge = bridge

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
        view.configuration = TerminalSurfaceOptions(backend: .inMemory(session))

        bridge.start()
        entries[sessionId] = Entry(view: view, state: state, bridge: bridge)
        return view
    }

    func evict(_ sessionId: String) {
        entries[sessionId]?.bridge.stop()
        entries.removeValue(forKey: sessionId)
    }
}

// MARK: - BridgeBox

/// Breaks the circular init dependency between `InMemoryTerminalSession` callbacks and
/// `TerminalSessionBridge`. @unchecked Sendable is safe here: the box is written exactly
/// once on @MainActor (immediately after bridge creation), and every read occurs inside a
/// `Task { @MainActor in … }` — no concurrent access is possible.
///
/// `bridge` is `weak` to break the retain cycle: Entry.bridge → bridge → session →
/// write/resize closures → BridgeBox → bridge. The dictionary's `Entry.bridge` is the only
/// strong owner, so the bridge (and its session + libghostty surface) deallocates the
/// instant `entries.removeValue` runs in `evict()`. Reads use optional-chaining
/// (`box.bridge?.…`), so a nil after eviction is already handled.
private final class BridgeBox: @unchecked Sendable {
    weak var bridge: TerminalSessionBridge?
}
