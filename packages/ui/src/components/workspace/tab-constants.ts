import { cva } from "class-variance-authority";
import type { AgentType } from "@taskflow/shared";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CodexIcon } from "@/components/icons/CodexIcon";
import { OpenCodeIcon } from "@/components/icons/OpenCodeIcon";
import { GeminiIcon } from "@/components/icons/GeminiIcon";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import { KimiIcon } from "@/components/icons/KimiIcon";

const AGENT_META: Record<
    AgentType,
    {
        icon: (props: { className?: string }) => React.ReactNode;
        colorClass: string;
    }
> = {
    claude: { icon: ClaudeIcon, colorClass: "text-warning" },
    codex: { icon: CodexIcon, colorClass: "text-success" },
    opencode: { icon: OpenCodeIcon, colorClass: "text-opencode" },
    gemini: { icon: GeminiIcon, colorClass: "text-primary" },
    cursor: { icon: CursorIcon, colorClass: "text-cursor-agent" },
    pi: { icon: PiIcon, colorClass: "text-primary" },
    kimi: { icon: KimiIcon, colorClass: "text-primary" },
};

const tabVariants = cva(
    "px-1.5 h-6 shrink-0 rounded-md cursor-pointer flex items-center gap-1 text-sm whitespace-nowrap transition-colors",
    {
        variants: {
            type: {
                claude: "text-warning",
                codex: "text-success",
                opencode: "text-opencode",
                gemini: "text-primary",
                cursor: "text-cursor-agent",
                pi: "text-primary",
                kimi: "text-primary",
                shell: "text-info",
                editor: "text-muted-foreground",
                changes: "text-muted-foreground",
                history: "text-muted-foreground",
                browser: "text-muted-foreground",
                markdown: "text-muted-foreground",
            },
            active: { true: "bg-muted", false: "bg-transparent hover:bg-muted/50" },
        },
        defaultVariants: { type: "editor", active: false },
    },
);

export { AGENT_META, tabVariants };
