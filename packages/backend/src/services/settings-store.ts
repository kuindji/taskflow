import { readFile, writeFile } from "fs/promises";
import { isAbsolute, resolve } from "path";
import {
    ALL_AGENT_TYPES,
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_PERMISSION_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    CODEX_SANDBOX_MODES,
    DEFAULT_AGENT_ACCOUNT_ID,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_MARKDOWN_WIDTH,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_GENERAL_FONT_FAMILY,
    DEFAULT_GENERAL_FONT_SIZE,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_SIZE,
    DEFAULT_TERMINAL_SHELL,
    DEFAULT_THEME_ID,
    INHERIT_AGENT_ACCOUNT,
    isAgentType,
} from "@taskflow/shared";
import type {
    AgentAccount,
    AppSettings,
    ClaudeSettings,
    CodexSettings,
    EditorSettings,
    NetworkSettings,
    GeneralSettings,
    OpenCodeSettings,
    RemoteAgentSettings,
    SettingsUpdatePayload,
} from "@taskflow/shared";

const DEFAULTS: AppSettings = {
    general: {
        fontFamily: DEFAULT_GENERAL_FONT_FAMILY,
        fontSize: DEFAULT_GENERAL_FONT_SIZE,
        defaultAgent: "claude",
        defaultRuntime: "bun",
        favoriteAgents: [...ALL_AGENT_TYPES],
        confirmBeforeExit: false,
    },
    terminal: {
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        fontSize: DEFAULT_TERMINAL_FONT_SIZE,
        defaultShell: DEFAULT_TERMINAL_SHELL,
    },
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
        wordWrap: DEFAULT_EDITOR_WORD_WRAP,
        internalEditor: "monaco",
        externalEditor: "system",
        markdownWidth: DEFAULT_EDITOR_MARKDOWN_WIDTH,
    },
    layout: {
        window: { width: 1400, height: 900, isMaximized: false },
        panels: {
            sidebarWidth: 220,
            fileExplorerWidth: 220,
            taskInfoWidth: 220,
            flowPanelWidth: 220,
            compactSidebar: false,
            collapsedProjectIds: [],
            wikiRailOpen: true,
            wikiRailWidth: 220,
        },
    },
    claude: {
        defaultModel: "default",
        defaultEffort: "default",
        permissionMode: "default",
        accounts: [],
        defaultAccount: "default",
    },
    codex: {
        defaultModel: "",
        defaultReasoningEffort: "default",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        dangerouslyBypassApprovalsAndSandbox: false,
        accounts: [],
        defaultAccount: "default",
    },
    opencode: {
        defaultModel: "",
        autoApprove: false,
    },
    pi: {
        defaultModel: "",
        thinking: "off",
        tools: "read,bash,edit,write,grep,find,ls",
    },
    kimi: {
        defaultModel: "",
        permissionMode: "manual",
    },
    appearance: {
        theme: DEFAULT_THEME_ID,
    },
    remoteAgent: {
        autoStart: false,
        appName: "",
        headless: false,
        permissionMode: "default",
    },
    network: {
        discoverable: true,
        displayName: "",
    },
};

function createDefaultSettings(): AppSettings {
    return {
        general: { ...DEFAULTS.general },
        terminal: { ...DEFAULTS.terminal },
        editor: { ...DEFAULTS.editor },
        layout: {
            window: { ...DEFAULTS.layout.window },
            panels: { ...DEFAULTS.layout.panels },
        },
        claude: { ...DEFAULTS.claude, accounts: [] },
        codex: { ...DEFAULTS.codex, accounts: [] },
        opencode: { ...DEFAULTS.opencode },
        pi: { ...DEFAULTS.pi },
        kimi: { ...DEFAULTS.kimi },
        appearance: { ...DEFAULTS.appearance },
        remoteAgent: { ...DEFAULTS.remoteAgent },
        network: { ...DEFAULTS.network },
    };
}

/** Apply partial update, deleting keys set to null so defaults fill in on next get(). */
function applyNullable<T extends object>(target: T, patch: { [K in keyof T]?: T[K] | null }): void {
    for (const key of Object.keys(patch) as Array<keyof T>) {
        if (patch[key] === null) {
            Reflect.deleteProperty(target, key);
        } else if (patch[key] !== undefined) {
            target[key] = patch[key] as T[keyof T];
        }
    }
}

function isAgentAccount(value: unknown): value is AgentAccount {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === "string" &&
        typeof record.name === "string" &&
        typeof record.homeDir === "string"
    );
}

/** Shape repair only. An unknown defaultAccount is kept so launches fail loudly. */
function normalizeAccountSettings(settings: ClaudeSettings | CodexSettings): boolean {
    let changed = false;
    // Read through `unknown` so this narrows on the actual runtime shape (which may
    // not match the static AgentAccount[] type for settings loaded from disk),
    // instead of TypeScript treating the "not every element matches" branch as
    // unreachable given the declared type.
    const accounts: unknown = settings.accounts;
    if (!Array.isArray(accounts)) {
        settings.accounts = [];
        changed = true;
    } else if (!accounts.every(isAgentAccount)) {
        settings.accounts = accounts.filter(isAgentAccount);
        changed = true;
    }
    if (typeof settings.defaultAccount !== "string" || settings.defaultAccount === "") {
        settings.defaultAccount = DEFAULT_AGENT_ACCOUNT_ID;
        changed = true;
    }
    return changed;
}

/**
 * Validates accounts and canonicalises their home dirs. Two spellings of one
 * directory ("/homes/x" and "/homes/x/") must not survive as distinct values:
 * downstream code compares home dirs by string (the Codex launch lock key, the
 * saved `SessionRef.agentHomeDir`, and the inherited-home check when resuming).
 */
function validateAndNormalizeAccountSettings(
    settings: ClaudeSettings | CodexSettings,
    agent: string,
): void {
    const ids = new Set<string>();
    const names = new Set<string>();
    const reserved = [DEFAULT_AGENT_ACCOUNT_ID, INHERIT_AGENT_ACCOUNT];
    const normalized: AgentAccount[] = [];
    for (const account of settings.accounts) {
        if (!account.id || reserved.includes(account.id) || ids.has(account.id)) {
            throw new Error(
                `${agent} account id "${account.id}" is empty, reserved, or duplicated`,
            );
        }
        ids.add(account.id);
        const name = account.name.trim();
        const key = name.toLowerCase();
        if (!name || reserved.includes(key) || names.has(key)) {
            throw new Error(
                `${agent} account name "${account.name}" is empty, reserved, or duplicated`,
            );
        }
        names.add(key);
        if (!isAbsolute(account.homeDir)) {
            throw new Error(`${agent} account "${name}" home directory must be an absolute path`);
        }
        normalized.push({ ...account, homeDir: resolve(account.homeDir) });
    }
    settings.accounts = normalized;
    if (settings.defaultAccount !== DEFAULT_AGENT_ACCOUNT_ID && !ids.has(settings.defaultAccount)) {
        throw new Error(
            `${agent} default account must be the built-in account or an existing account; choose another default account before deleting it`,
        );
    }
}

function normalizeCodexSettings(settings: CodexSettings, defaults: CodexSettings): boolean {
    const legacy = settings as CodexSettings & { fullAuto?: unknown };
    let changed = false;

    if (typeof settings.defaultModel !== "string") {
        settings.defaultModel = defaults.defaultModel;
        changed = true;
    }
    if (
        settings.defaultReasoningEffort !== "default" &&
        !(CODEX_REASONING_EFFORTS as readonly unknown[]).includes(settings.defaultReasoningEffort)
    ) {
        settings.defaultReasoningEffort = defaults.defaultReasoningEffort;
        changed = true;
    }
    if (!(CODEX_SANDBOX_MODES as readonly unknown[]).includes(settings.sandbox)) {
        settings.sandbox = defaults.sandbox;
        changed = true;
    }
    if (!(CODEX_APPROVAL_POLICIES as readonly unknown[]).includes(settings.approvalPolicy)) {
        const legacyPolicy: unknown = settings.approvalPolicy;
        settings.approvalPolicy =
            legacyPolicy === "always" || legacyPolicy === "unless-allow-listed"
                ? "untrusted"
                : defaults.approvalPolicy;
        changed = true;
    }
    if (typeof settings.dangerouslyBypassApprovalsAndSandbox !== "boolean") {
        settings.dangerouslyBypassApprovalsAndSandbox =
            defaults.dangerouslyBypassApprovalsAndSandbox;
        changed = true;
    }
    if (legacy.fullAuto !== undefined) {
        if (legacy.fullAuto === true) {
            settings.sandbox = "workspace-write";
            settings.approvalPolicy = "on-request";
        }
        delete legacy.fullAuto;
        changed = true;
    }

    changed = normalizeAccountSettings(settings) || changed;

    return changed;
}

function normalizeClaudeSettings(settings: ClaudeSettings, defaults: ClaudeSettings): boolean {
    const legacy = settings as ClaudeSettings & { dangerouslySkipPermissions?: unknown };
    let changed = false;

    if (typeof settings.defaultModel !== "string") {
        settings.defaultModel = defaults.defaultModel;
        changed = true;
    }
    if (
        settings.defaultEffort !== "default" &&
        !(CLAUDE_EFFORT_LEVELS as readonly unknown[]).includes(settings.defaultEffort)
    ) {
        settings.defaultEffort = defaults.defaultEffort;
        changed = true;
    }

    const permissionModeIsValid =
        settings.permissionMode === "default" ||
        (CLAUDE_PERMISSION_MODES as readonly unknown[]).includes(settings.permissionMode);
    if (
        legacy.dangerouslySkipPermissions === true &&
        (settings.permissionMode === "default" || !permissionModeIsValid)
    ) {
        settings.permissionMode = "bypassPermissions";
        changed = true;
    } else if (!permissionModeIsValid) {
        settings.permissionMode = defaults.permissionMode;
        changed = true;
    }
    if (legacy.dangerouslySkipPermissions !== undefined) {
        delete legacy.dangerouslySkipPermissions;
        changed = true;
    }

    changed = normalizeAccountSettings(settings) || changed;

    return changed;
}

function normalizeRemoteAgentSettings(
    settings: RemoteAgentSettings,
    defaults: RemoteAgentSettings,
): boolean {
    let changed = false;
    if (typeof settings.autoStart !== "boolean") {
        settings.autoStart = defaults.autoStart;
        changed = true;
    }
    if (typeof settings.appName !== "string") {
        settings.appName = defaults.appName;
        changed = true;
    }
    if (typeof settings.headless !== "boolean") {
        settings.headless = defaults.headless;
        changed = true;
    }
    if (
        settings.permissionMode !== "default" &&
        !(CLAUDE_PERMISSION_MODES as readonly unknown[]).includes(settings.permissionMode)
    ) {
        settings.permissionMode = defaults.permissionMode;
        changed = true;
    }
    return changed;
}

/** The advertiser reads these on every announce, so a hand-edited value of the
 *  wrong type would throw there and take the backend down. */
function normalizeNetworkSettings(settings: NetworkSettings, defaults: NetworkSettings): boolean {
    let changed = false;
    if (typeof settings.discoverable !== "boolean") {
        settings.discoverable = defaults.discoverable;
        changed = true;
    }
    if (typeof settings.displayName !== "string") {
        settings.displayName = defaults.displayName;
        changed = true;
    }
    return changed;
}

export class SettingsStore {
    private updateListeners = new Set<(settings: AppSettings) => void>();

    constructor(private filePath: string) {}

    /** Called after every `update()` with the re-read settings. Both the WS handler
     *  and `PATCH /api/settings` write through `update()`, so this sees both. */
    onUpdated(listener: (settings: AppSettings) => void): void {
        this.updateListeners.add(listener);
    }

    async get(): Promise<AppSettings> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            const parsed = JSON.parse(raw) as Partial<AppSettings> & {
                general?: Partial<GeneralSettings> & { externalEditor?: string };
            };
            const defaults = createDefaultSettings();

            // Migration: move externalEditor from general to editor
            let needsMigration = false;
            if (parsed.general && "externalEditor" in parsed.general) {
                const editorPartial: Partial<EditorSettings> = parsed.editor ?? {};
                if (!editorPartial.externalEditor) {
                    editorPartial.externalEditor = parsed.general.externalEditor;
                }
                parsed.editor = editorPartial as EditorSettings;
                delete parsed.general.externalEditor;
                needsMigration = true;
            }

            const result: AppSettings = {
                general: { ...defaults.general, ...parsed.general },
                terminal: { ...defaults.terminal, ...parsed.terminal },
                editor: { ...defaults.editor, ...parsed.editor },
                layout: {
                    window: { ...defaults.layout.window, ...parsed.layout?.window },
                    panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
                },
                claude: { ...defaults.claude, ...parsed.claude },
                codex: { ...defaults.codex, ...parsed.codex },
                opencode: { ...defaults.opencode, ...parsed.opencode },
                pi: { ...defaults.pi, ...parsed.pi },
                kimi: { ...defaults.kimi, ...parsed.kimi },
                appearance: { ...defaults.appearance, ...parsed.appearance },
                remoteAgent: { ...defaults.remoteAgent, ...parsed.remoteAgent },
                network: { ...defaults.network, ...parsed.network },
            };

            // Tolerate agent values written by newer builds: drop unknown
            // entries instead of crashing downstream consumers that narrow on
            // the closed AgentType union. The on-disk file is left untouched
            // so the newer build keeps its authoritative values.
            if (!isAgentType(result.general.defaultAgent)) {
                result.general.defaultAgent = defaults.general.defaultAgent;
            }
            if (Array.isArray(result.general.favoriteAgents)) {
                result.general.favoriteAgents = result.general.favoriteAgents.filter(isAgentType);
            }
            // Drop the retired OpenCode variant setting carried in from older files.
            const opencodeSettings: OpenCodeSettings & { defaultVariant?: string } =
                result.opencode;
            if (opencodeSettings.defaultVariant !== undefined) {
                delete opencodeSettings.defaultVariant;
                needsMigration = true;
            }
            needsMigration =
                normalizeClaudeSettings(result.claude, defaults.claude) || needsMigration;
            needsMigration = normalizeCodexSettings(result.codex, defaults.codex) || needsMigration;
            needsMigration =
                normalizeRemoteAgentSettings(result.remoteAgent, defaults.remoteAgent) ||
                needsMigration;
            needsMigration =
                normalizeNetworkSettings(result.network, defaults.network) || needsMigration;

            // Persist migration so it only runs once
            if (needsMigration) {
                await writeFile(this.filePath, JSON.stringify(result, null, 2));
            }

            return result;
        } catch {
            return createDefaultSettings();
        }
    }

    async update(partial: SettingsUpdatePayload): Promise<AppSettings> {
        const current = await this.get();
        if (partial.general) {
            applyNullable(current.general, partial.general);
        }
        if (partial.terminal) {
            applyNullable(current.terminal, partial.terminal);
        }
        if (partial.editor) {
            applyNullable(current.editor, partial.editor);
        }
        if (partial.layout?.window) {
            applyNullable(current.layout.window, partial.layout.window);
        }
        if (partial.layout?.panels) {
            applyNullable(current.layout.panels, partial.layout.panels);
        }
        if (partial.claude) {
            applyNullable(current.claude, partial.claude);
            normalizeClaudeSettings(current.claude, DEFAULTS.claude);
            validateAndNormalizeAccountSettings(current.claude, "Claude");
        }
        if (partial.codex) {
            applyNullable(current.codex, partial.codex);
            normalizeCodexSettings(current.codex, DEFAULTS.codex);
            validateAndNormalizeAccountSettings(current.codex, "Codex");
        }
        if (partial.opencode) {
            applyNullable(current.opencode, partial.opencode);
        }
        if (partial.pi) {
            applyNullable(current.pi, partial.pi);
        }
        if (partial.kimi) {
            applyNullable(current.kimi, partial.kimi);
        }
        if (partial.appearance) {
            applyNullable(current.appearance, partial.appearance);
        }
        if (partial.remoteAgent) {
            applyNullable(current.remoteAgent, partial.remoteAgent);
            normalizeRemoteAgentSettings(current.remoteAgent, DEFAULTS.remoteAgent);
        }
        if (partial.network) {
            applyNullable(current.network, partial.network);
        }
        // Persist without null keys so defaults fill in on next get()
        await writeFile(this.filePath, JSON.stringify(current, null, 2));
        // Re-read to apply defaults for any deleted keys
        const settings = await this.get();
        for (const listener of this.updateListeners) listener(settings);
        return settings;
    }
}
