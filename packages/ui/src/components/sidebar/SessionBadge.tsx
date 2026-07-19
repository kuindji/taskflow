import type { SessionRef } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";

export function SessionBadge({ session }: { session: SessionRef }) {
    const status = useSessionStore((s) => s.sessionStatus[session.id]);
    const colorScheme =
        session.type === "claude" ? "claude" : session.type === "shell" ? "shell" : "codex";

    return (
        <Badge variant="outline" colorScheme={colorScheme} className="px-1 py-0 text-xs">
            <StatusDot status={status} className="mr-0.5" />
            {session.type}
        </Badge>
    );
}
