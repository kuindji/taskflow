# View-Model Convention

Every domain view model in Taskflow native follows this pattern. `TaskViewModel` is the template; all subsequent VMs mirror it.

## Pattern

```swift
@MainActor
@Observable
final class FooViewModel {
    // Plain stored properties — no @Published, no @State
    private(set) var items: [Item] = []
    private(set) var loading: Bool = false

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    /// Fires the initial RPC to populate state. Called once by AppEnvironment.boot().
    func load() async { ... }

    /// Registers WS-event handlers via client.on(_:). Called once at composition by AppEnvironment.
    func bind() { ... }

    // Non-trivial mutations are static so XCTest can cover them without async plumbing.
    static func applyFoo(_ items: [Item], _ updated: Item) -> [Item] { ... }
}
```

## Rules

- **`@MainActor @Observable final class`** — every VM is main-actor–isolated and uses Apple's
  Observation framework (macOS 14+, `import Observation`). No `ObservableObject`, no `@Published`.
- **Plain stored properties** — Observation registers each read at call-site; no wiring needed.
- **`init(client:)`** — the WS transport is injected; no singleton access inside the VM.
- **`func load() async`** — fires the initial RPC, called once by `AppEnvironment.boot()`.
- **`func bind()`** — registers WS-event handlers via `client.on(_:)`, called once at composition.
  This replaces the TypeScript pattern of module-level `onEvent(MSG.XXX, ...)` side-effects
  that are registered on first import of the store file.
- **Pure reducers** — non-trivial state mutations are `static` functions so XCTest can drive
  them without mock transports or async setup.
- **`@ObservationIgnored`** on immutable or non-UI references (e.g. `client`) — keeps the
  Observation machinery lightweight by excluding references that never need to trigger re-renders.
- **Event handlers use `Task { @MainActor [weak self] in … }`** — the `client.on` closure type
  is non-isolated (`@escaping (E) -> Void`); crossing into main-actor state requires an explicit
  `@MainActor` task, which also avoids retain cycles via `[weak self]`.

## Why Observation Solves the Zustand Reactivity Gotcha

Observation tracks **per-property reads** at the call-site. A SwiftUI view that reads only
`tasks` will not re-render when `loading` flips, and vice-versa — the framework enforces this
mechanically without any configuration. In the Electron app the project carries the
`project_zustand_reactivity` gotcha because destructuring `useTaskStore()` subscribes every
rendered component to the **entire** store object, causing spurious re-renders whenever any
field changes; the common workaround is Zustand "stable selectors" (manual per-field
subscriptions), which developers must remember to apply correctly.

With Observation, the "select only what you read" discipline is **automatic and opt-out-proof**:
the framework sees exactly which stored property each view closure touched during its last render
and re-runs only when those specific properties change.

**Do NOT collapse state into a single computed blob** (e.g. a tuple property that merges
`tasks + loading` into one return value). Doing so defeats per-property tracking — a view that
reads the blob re-renders on every field change inside it, reproducing the Zustand problem.
Keep granular stored properties so fine-grained invalidation is preserved.

> Memory note: `project_zustand_reactivity` — Zustand reactive pitfall and the stable-selector
> discipline that Observation replaces automatically.
