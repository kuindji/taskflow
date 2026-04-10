type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";

const ALL_AGENT_TYPES: AgentType[] = [
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
    "pi",
];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
    pi: "Pi",
};

type ClaudePermissionMode =
    | "default"
    | "acceptEdits"
    | "bypassPermissions"
    | "dontAsk"
    | "plan"
    | "auto";

type ClaudeEffortLevel = "low" | "medium" | "high" | "max";

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    dangerouslySkipPermissions?: boolean;
    permissionMode?: ClaudePermissionMode;
    model?: string;
    effort?: ClaudeEffortLevel;
}

type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type CodexApprovalPolicy = "always" | "unless-allow-listed" | "on-request" | "never";

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    model?: string;
    sandbox?: CodexSandboxMode;
    approvalPolicy?: CodexApprovalPolicy;
    fullAuto?: boolean;
}

interface OpenCodeLaunchOptions {
    type: Extract<AgentType, "opencode">;
    model?: string;
    variant?: string;
    autoApprove?: boolean;
}

interface OpenCodeModelInfo {
    id: string;
    provider: string;
}

interface GeminiLaunchOptions {
    type: Extract<AgentType, "gemini">;
    approvalMode?: "default" | "auto_edit" | "yolo" | "plan";
    sandbox?: boolean;
    model?: string;
}

interface CursorLaunchOptions {
    type: Extract<AgentType, "cursor">;
    yolo?: boolean;
    model?: string;
}

type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PiLaunchOptions {
    type: Extract<AgentType, "pi">;
    /** Assembled as `${provider}/${id}` — passed verbatim to `--model`. */
    model?: string;
    thinking?: PiThinkingLevel;
    /** Comma-separated tool list; empty/undefined omits the `--tools` flag. */
    tools?: string;
}

interface PiModelInfo {
    provider: string;
    id: string;
    /** Display-only string, e.g. "272K". */
    contextWindow: string;
    /** Display-only string, e.g. "128K". */
    maxOutput: string;
    supportsThinking: boolean;
    supportsImages: boolean;
}

type AgentLaunchOptions =
    | ClaudeLaunchOptions
    | CodexLaunchOptions
    | OpenCodeLaunchOptions
    | GeminiLaunchOptions
    | CursorLaunchOptions
    | PiLaunchOptions;

interface AgentAvailability {
    type: AgentType;
    available: boolean;
    path: string;
    version: string;
}

export { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES };

export type {
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    CodexSandboxMode,
    CodexApprovalPolicy,
    OpenCodeLaunchOptions,
    GeminiLaunchOptions,
    CursorLaunchOptions,
    PiThinkingLevel,
    PiLaunchOptions,
    PiModelInfo,
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
};
