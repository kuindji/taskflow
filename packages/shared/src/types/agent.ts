type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor";

const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor"];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
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
    approvalMode?: "default" | "auto_edit" | "yolo" | "plan";
    sandbox?: boolean;
    model?: string;
}

interface CursorLaunchOptions {
    type: Extract<AgentType, "cursor">;
    yolo?: boolean;
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
    ClaudePermissionMode,
    ClaudeEffortLevel,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    CodexSandboxMode,
    CodexApprovalPolicy,
    OpenCodeLaunchOptions,
    GeminiLaunchOptions,
    CursorLaunchOptions,
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
    OpenCodeAgentInfo,
};
