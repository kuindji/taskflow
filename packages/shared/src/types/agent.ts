type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi";

const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi", "kimi"];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
    pi: "Pi",
    kimi: "Kimi",
};

const CLAUDE_PERMISSION_MODES = [
    "manual",
    "acceptEdits",
    "bypassPermissions",
    "dontAsk",
    "plan",
    "auto",
] as const;
const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max", "ultracode"] as const;

type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];
type ClaudeEffortLevel = (typeof CLAUDE_EFFORT_LEVELS)[number];

interface ClaudeLaunchOptions {
    type: Extract<AgentType, "claude">;
    permissionMode?: ClaudePermissionMode;
    model?: string;
    effort?: ClaudeEffortLevel;
}

const CODEX_SANDBOX_MODES = ["read-only", "workspace-write", "danger-full-access"] as const;
const CODEX_APPROVAL_POLICIES = ["untrusted", "on-request", "never"] as const;
const CODEX_REASONING_EFFORTS = [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
] as const;

type CodexSandboxMode = (typeof CODEX_SANDBOX_MODES)[number];
type CodexApprovalPolicy = (typeof CODEX_APPROVAL_POLICIES)[number];
type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

interface CodexLaunchOptions {
    type: Extract<AgentType, "codex">;
    model?: string;
    reasoningEffort?: CodexReasoningEffort;
    sandbox?: CodexSandboxMode;
    approvalPolicy?: CodexApprovalPolicy;
    dangerouslyBypassApprovalsAndSandbox?: boolean;
}

interface CodexReasoningEffortInfo {
    reasoningEffort: CodexReasoningEffort;
    description: string;
}

interface CodexModelInfo {
    id: string;
    model: string;
    displayName: string;
    description: string;
    hidden: boolean;
    supportedReasoningEfforts: CodexReasoningEffortInfo[];
    defaultReasoningEffort: CodexReasoningEffort;
    inputModalities: string[];
    isDefault: boolean;
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

const KIMI_PERMISSION_MODES = ["manual", "auto", "yolo"] as const;

type KimiPermissionMode = (typeof KIMI_PERMISSION_MODES)[number];

interface KimiLaunchOptions {
    type: Extract<AgentType, "kimi">;
    /** Model alias key from `kimi provider list --json`, e.g. "kimi-code/k3" — passed to `--model`. */
    model?: string;
    /** "manual" omits flags; "auto" → `--auto`; "yolo" → `--yolo` (CLI rejects both together). */
    permissionMode?: KimiPermissionMode;
}

interface KimiModelInfo {
    /** Alias key, e.g. "kimi-code/k3". */
    id: string;
    /** e.g. "K3". */
    displayName: string;
    /** Display-only string derived from maxContextSize, e.g. "256K". */
    contextWindow: string;
}

type AgentLaunchOptions =
    | ClaudeLaunchOptions
    | CodexLaunchOptions
    | OpenCodeLaunchOptions
    | GeminiLaunchOptions
    | CursorLaunchOptions
    | PiLaunchOptions
    | KimiLaunchOptions;

interface AgentAvailability {
    type: AgentType;
    available: boolean;
    path: string;
    version: string;
}

export {
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    CLAUDE_PERMISSION_MODES,
    CLAUDE_EFFORT_LEVELS,
    CODEX_SANDBOX_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    KIMI_PERMISSION_MODES,
};

export type {
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    CodexSandboxMode,
    CodexApprovalPolicy,
    CodexReasoningEffort,
    CodexReasoningEffortInfo,
    CodexModelInfo,
    OpenCodeLaunchOptions,
    GeminiLaunchOptions,
    CursorLaunchOptions,
    PiThinkingLevel,
    PiLaunchOptions,
    PiModelInfo,
    KimiPermissionMode,
    KimiLaunchOptions,
    KimiModelInfo,
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
};
