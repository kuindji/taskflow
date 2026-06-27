/// Whether an option fragment is editing app-wide defaults or a single session's overrides.
/// Mirrors the `mode?: "defaults" | "session"` prop on components/shared/*Options.tsx.
enum AgentOptionsMode {
    case defaults
    case session
}
