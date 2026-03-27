import { useCallback } from "react";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";
import type { Tab } from "@/stores/session-helpers";

const AGENT_SESSION_TYPES: ReadonlySet<Tab["type"]> = new Set([
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
]);

interface MarkdownInputHelperProps {
    sessionId: string;
    sessionType: Tab["type"];
}

function MarkdownInputHelper({ sessionId, sessionType }: MarkdownInputHelperProps) {
    const isOpen = useMarkdownInputStore((s) => getEditor(s, sessionId).isOpen);
    const toggle = useMarkdownInputStore((s) => s.toggle);

    const handleToggle = useCallback(() => {
        toggle(sessionId);
    }, [toggle, sessionId]);

    if (!AGENT_SESSION_TYPES.has(sessionType)) return null;
    if (isOpen) return null; // Editor panel will render instead (Task 3)

    return (
        <button
            type="button"
            onClick={handleToggle}
            className="absolute bottom-3 right-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-accent-foreground"
            title="Markdown Input (⌘⇧I)"
        >
            <PenIcon />
        </button>
    );
}

function PenIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    );
}

export { MarkdownInputHelper, AGENT_SESSION_TYPES };
