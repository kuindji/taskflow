// Port of packages/ui/src/components/schedules/schedule-helpers.ts
// + ScheduleManagementDialog row helpers (formatRelativeTime, getScheduleStatus)
import Foundation

enum ScheduleRowStatus { case running, error, idle }

enum ScheduleHelpers {
    nonisolated static func normalizeTimeout(_ raw: String) -> Double {
        if let v = Int(raw.trimmingCharacters(in: .whitespaces)), v > 0 { return Double(v) }
        return 30
    }

    nonisolated static func computeNextRunPreview(expression: String, expressionType: String, now: Date) -> String? {
        guard expressionType == "rate" else { return nil }   // cron preview needs backend
        let pattern = #"^rate\((\d+)\s+(minutes?|hours?|days?)\)$"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let s = expression.trimmingCharacters(in: .whitespaces)
        let range = NSRange(s.startIndex..., in: s)
        guard let m = re.firstMatch(in: s, range: range),
              let vR = Range(m.range(at: 1), in: s), let uR = Range(m.range(at: 2), in: s),
              let value = Int(s[vR]) else { return nil }
        var unit = String(s[uR]).lowercased()
        if unit.hasSuffix("s") { unit.removeLast() }
        let seconds: Double
        switch unit {
        case "minute": seconds = 60
        case "hour": seconds = 3600
        case "day": seconds = 86400
        default: return nil
        }
        let date = now.addingTimeInterval(Double(value) * seconds)
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }

    nonisolated static func formatRelativeTime(_ iso: String?, now: Date) -> String {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return "Never" }
        let diff = now.timeIntervalSince(date)
        if diff < 0 { return "Just now" }
        if diff < 60 { return "\(Int(diff))s ago" }
        if diff < 3600 { return "\(Int(diff / 60))m ago" }
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        return "\(Int(diff / 86400))d ago"
    }

    nonisolated static func scheduleStatus(runningSessionId: String?, lastError: String?) -> ScheduleRowStatus {
        if runningSessionId != nil { return .running }
        if lastError != nil { return .error }
        return .idle
    }

    nonisolated static func dirtyKey(includeProjectId: Bool, projectId: String, name: String, actionId: String,
                                     prompt: String, expression: String, expressionType: String, agentType: String,
                                     agentOptions: AgentLaunchOptions?, timeout: String, useAction: Bool) -> String {
        // Port of serializeScheduleState — canonical key for hasChanges dirty-checking.
        var parts: [String] = []
        parts.append("projectId=\(includeProjectId ? projectId : "")")
        parts.append("name=\(name)")
        parts.append("actionId=\(actionId)")
        parts.append("prompt=\(useAction ? "" : prompt)")
        parts.append("expression=\(expression)")
        parts.append("expressionType=\(expressionType)")
        parts.append("agentType=\(useAction ? "" : agentType)")
        let sessionType = SessionType(rawValue: agentType) ?? .shell
        let normalized = useAction ? nil : AgentOptionsNormalize.normalized(type: sessionType, options: agentOptions)
        if let normalized, let data = try? JSONEncoder().encode(normalized), let str = String(data: data, encoding: .utf8) {
            parts.append("agentOptions=\(str)")
        } else {
            parts.append("agentOptions=")
        }
        parts.append("timeout=\(normalizeTimeout(timeout))")
        return parts.joined(separator: "&")
    }
}
