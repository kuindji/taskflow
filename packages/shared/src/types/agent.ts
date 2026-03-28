type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor";

const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor"];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
};

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
}

interface OpenCodeLaunchOptions {
    type: Extract<AgentType, "opencode">;
    model?: string;
    agent?: string;
    variant?: string;
    autoApprove?: boolean;
}

interface OpenCodeModelInfo {
    id: string;
    provider: string;
}

interface OpenCodeAgentInfo {
    name: string;
    kind: string;
}

interface GeminiLaunchOptions {
    type: Extract<AgentType, "gemini">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: "auto" | "pro" | "flash" | "flash-lite";
}

interface CursorLaunchOptions {
    type: Extract<AgentType, "cursor">;
    fullAccess?: boolean;
    dontAskQuestions?: boolean;
    model?: string;
}

type AgentLaunchOptions =
    | ClaudeLaunchOptions
    | CodexLaunchOptions
    | OpenCodeLaunchOptions
    | GeminiLaunchOptions
    | CursorLaunchOptions;

interface AgentAvailability {
    type: AgentType;
    available: boolean;
    path: string;
    version: string;
}

export { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES };

export type {
    AgentType,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    OpenCodeLaunchOptions,
    GeminiLaunchOptions,
    CursorLaunchOptions,
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
    OpenCodeAgentInfo,
};
