import {
    ScrollBoxRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import {
    CLAUDE_PERMISSION_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    CODEX_SANDBOX_MODES,
    KIMI_PERMISSION_MODES,
    type AppSettings,
    type Project,
    type SettingsUpdatePayload,
} from "@taskflow/shared";
import type { Choice, SettingsChoices } from "../settings/store";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface SettingsItem {
    id: string;
    label: string;
    value: string;
    options: Choice[];
    payload(value: string): SettingsUpdatePayload;
}

interface SettingsDeps {
    renderer: CliRenderer;
    settings: AppSettings | null;
    choices: SettingsChoices;
    projects: readonly Project[];
    onSave(item: SettingsItem, value: string): void;
    onClose(): void;
    onStateChange?(): void;
}

function optionsWithCurrent(options: readonly Choice[], current: string): Choice[] {
    const unique = options.filter(
        (option, index) => options.findIndex((candidate) => candidate.value === option.value) === index,
    );
    if (!current || unique.some((option) => option.value === current)) return [...unique];
    return [{ value: current, label: `${current} (unavailable)` }, ...unique];
}

function textOptions(values: readonly string[]): Choice[] {
    return values.map((value) => ({ value, label: value }));
}

function settingsItems(
    settings: AppSettings | null,
    choices: SettingsChoices,
    projects: readonly Project[],
): SettingsItem[] {
    if (!settings) return [];
    const item = (
        id: string,
        label: string,
        value: string,
        options: readonly Choice[],
        payload: (next: string) => SettingsUpdatePayload,
    ): SettingsItem => ({
        id,
        label,
        value,
        options: optionsWithCurrent(options, value),
        payload,
    });
    const booleanOptions = textOptions(["false", "true"]);
    const collapsed = settings.layout.panels.collapsedProjectIds;
    return [
        item("agent", "Default agent", settings.general.defaultAgent, choices.agents, (value) => ({
            general: { defaultAgent: value as AppSettings["general"]["defaultAgent"] },
        })),
        item("runtime", "Default runtime", settings.general.defaultRuntime, choices.runtimes, (value) => ({
            general: { defaultRuntime: value },
        })),
        item("shell", "Default shell", settings.terminal.defaultShell, choices.shells, (value) => ({
            terminal: { defaultShell: value },
        })),
        item("editor", "Terminal editor", settings.editor.internalEditor, choices.editors, (value) => ({
            editor: { internalEditor: value },
        })),
        item(
            "sidebar-width",
            "Sidebar width",
            String(settings.layout.panels.sidebarWidth),
            textOptions(["160", "200", "240", "280", "320", "360", "400"]),
            (value) => ({ layout: { panels: { sidebarWidth: Number.parseInt(value, 10) } } }),
        ),
        item(
            "claude-model",
            "Claude model",
            settings.claude.defaultModel,
            textOptions(["default"]),
            (value) => ({ claude: { defaultModel: value } }),
        ),
        item(
            "claude-permission",
            "Claude permission",
            settings.claude.permissionMode,
            textOptions(["default", ...CLAUDE_PERMISSION_MODES]),
            (value) => ({
                claude: { permissionMode: value as AppSettings["claude"]["permissionMode"] },
            }),
        ),
        item(
            "codex-model",
            "Codex model",
            settings.codex.defaultModel,
            [{ value: "", label: "Codex default" }, ...choices.models.codex],
            (value) => ({ codex: { defaultModel: value } }),
        ),
        item(
            "codex-reasoning",
            "Codex reasoning",
            settings.codex.defaultReasoningEffort,
            textOptions(["default", ...CODEX_REASONING_EFFORTS]),
            (value) => ({
                codex: {
                    defaultReasoningEffort:
                        value as AppSettings["codex"]["defaultReasoningEffort"],
                },
            }),
        ),
        item(
            "codex-sandbox",
            "Codex sandbox",
            settings.codex.sandbox,
            textOptions(CODEX_SANDBOX_MODES),
            (value) => ({ codex: { sandbox: value as AppSettings["codex"]["sandbox"] } }),
        ),
        item(
            "codex-approval",
            "Codex approval",
            settings.codex.approvalPolicy,
            textOptions(CODEX_APPROVAL_POLICIES),
            (value) => ({
                codex: { approvalPolicy: value as AppSettings["codex"]["approvalPolicy"] },
            }),
        ),
        item(
            "codex-bypass",
            "Codex bypass approvals",
            String(settings.codex.dangerouslyBypassApprovalsAndSandbox),
            booleanOptions,
            (value) => ({ codex: { dangerouslyBypassApprovalsAndSandbox: value === "true" } }),
        ),
        item(
            "opencode-model",
            "OpenCode model",
            settings.opencode.defaultModel,
            [{ value: "", label: "OpenCode default" }, ...choices.models.opencode],
            (value) => ({ opencode: { defaultModel: value } }),
        ),
        item(
            "opencode-approve",
            "OpenCode auto approve",
            String(settings.opencode.autoApprove),
            booleanOptions,
            (value) => ({ opencode: { autoApprove: value === "true" } }),
        ),
        item(
            "pi-model",
            "Pi model",
            settings.pi.defaultModel,
            [{ value: "", label: "Pi default" }, ...choices.models.pi],
            (value) => ({ pi: { defaultModel: value } }),
        ),
        item(
            "kimi-model",
            "Kimi model",
            settings.kimi.defaultModel,
            [{ value: "", label: "Kimi default" }, ...choices.models.kimi],
            (value) => ({ kimi: { defaultModel: value } }),
        ),
        item(
            "kimi-permission",
            "Kimi permission",
            settings.kimi.permissionMode,
            textOptions(KIMI_PERMISSION_MODES),
            (value) => ({
                kimi: { permissionMode: value as AppSettings["kimi"]["permissionMode"] },
            }),
        ),
        ...projects.map((project) =>
            item(
                `collapse:${project.id}`,
                `Project ${project.name}`,
                collapsed.includes(project.id) ? "collapsed" : "expanded",
                textOptions(["expanded", "collapsed"]),
                (value) => ({
                    layout: {
                        panels: {
                            collapsedProjectIds:
                                value === "collapsed"
                                    ? [...new Set([...collapsed, project.id])]
                                    : collapsed.filter((id) => id !== project.id),
                        },
                    },
                }),
            ),
        ),
    ];
}

class Settings {
    readonly renderable: ScrollBoxRenderable;
    private items: SettingsItem[];
    private selected = 0;
    private draftValue: string | null = null;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: SettingsDeps) {
        this.items = settingsItems(deps.settings, deps.choices, deps.projects);
        this.renderable = new ScrollBoxRenderable(deps.renderer, {
            id: "settings",
            width: "100%",
            height: "100%",
            scrollY: true,
            scrollX: false,
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.move(direction === "up" ? -1 : 1);
            },
        });
        this.rebuild();
    }

    get selectedId(): string | null {
        return this.items[this.selected]?.id ?? null;
    }

    get keyHints(): string {
        return this.pending
            ? " Saving..."
            : " ↑↓ Setting  ←→ Choice  Enter Save  Esc/q Sessions";
    }

    update(settings: AppSettings | null, choices: SettingsChoices, projects: readonly Project[]): void {
        const selectedId = this.selectedId;
        const previous = this.selected;
        this.items = settingsItems(settings, choices, projects);
        const retained = selectedId
            ? this.items.findIndex((candidate) => candidate.id === selectedId)
            : -1;
        this.selected = retained >= 0 ? retained : Math.min(previous, Math.max(0, this.items.length - 1));
        this.draftValue = null;
        this.pending = false;
        this.rebuild();
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (chorded) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (event.name === "left" || event.sequence === "h") return this.choose(-1);
        if (event.name === "right" || event.sequence === "l") return this.choose(1);
        if (event.name === "return" || event.name === "enter") this.save();
    }

    private move(delta: number): void {
        if (this.items.length === 0) return;
        this.selected = Math.min(this.items.length - 1, Math.max(0, this.selected + delta));
        this.draftValue = null;
        this.error = null;
        this.rebuild();
    }

    private choose(delta: number): void {
        const item = this.items[this.selected];
        if (!item || item.options.length === 0) return;
        const current = this.draftValue ?? item.value;
        const index = Math.max(0, item.options.findIndex((option) => option.value === current));
        const next = (index + delta + item.options.length) % item.options.length;
        this.draftValue = item.options[next].value;
        this.error = null;
        this.rebuild();
    }

    private save(): void {
        const item = this.items[this.selected];
        if (!item) return;
        const value = this.draftValue ?? item.value;
        this.pending = true;
        this.error = null;
        this.rebuild();
        this.deps.onSave(item, value);
    }

    private rebuild(): void {
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.renderable.add(
            new TextRenderable(this.deps.renderer, { content: " TUI settings", height: 1 }),
        );
        if (this.items.length === 0) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, { content: " Loading settings...", height: 1 }),
            );
        }
        for (const [index, item] of this.items.entries()) {
            const value = index === this.selected && this.draftValue !== null ? this.draftValue : item.value;
            const label = item.options.find((option) => option.value === value)?.label ?? value;
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${item.label}: ${label}`,
                    height: 1,
                    truncate: true,
                    wrapMode: "none",
                    ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                }),
            );
        }
        if (this.pending) {
            this.renderable.add(new TextRenderable(this.deps.renderer, { content: " Saving...", height: 1 }));
        } else if (this.error) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    minHeight: 1,
                    wrapMode: "word",
                }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { Settings, optionsWithCurrent, settingsItems };
export type { SettingsDeps, SettingsItem };
