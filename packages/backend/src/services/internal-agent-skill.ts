import { access, chmod, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import cliScript from "./taskflow-cli.sh" with { type: "text" };
import { isWindows } from "./platform";
import skillMarkdown from "./taskflow-cli-skill.md" with { type: "text" };
import taskCommandsMd from "./taskflow-cli-task-commands.md" with { type: "text" };
import projectCommandsMd from "./taskflow-cli-project-commands.md" with { type: "text" };
import flowCommandsMd from "./taskflow-cli-flow-commands.md" with { type: "text" };
import actionCommandsMd from "./taskflow-cli-action-commands.md" with { type: "text" };
import flowContextCommandsMd from "./taskflow-cli-flow-context-commands.md" with { type: "text" };
import agentCommandsMd from "./taskflow-cli-agent-commands.md" with { type: "text" };
import scheduleCommandsMd from "./taskflow-cli-schedule-commands.md" with { type: "text" };
import sessionCommandsMd from "./taskflow-cli-session-commands.md" with { type: "text" };
import browserCommandsMd from "./taskflow-cli-browser-commands.md" with { type: "text" };
import otherCommandsMd from "./taskflow-cli-other-commands.md" with { type: "text" };
import type { AgentLaunchOptions, LinkedProject } from "@taskflow/shared";
import {
    CLAUDE_EFFORT_LEVELS,
    CLAUDE_PERMISSION_MODES,
    CODEX_APPROVAL_POLICIES,
    CODEX_REASONING_EFFORTS,
    CODEX_SANDBOX_MODES,
} from "@taskflow/shared";

const COMMAND_FILES: Record<string, string> = {
    "taskflow-cli-task-commands.md": taskCommandsMd,
    "taskflow-cli-project-commands.md": projectCommandsMd,
    "taskflow-cli-flow-commands.md": flowCommandsMd,
    "taskflow-cli-action-commands.md": actionCommandsMd,
    "taskflow-cli-flow-context-commands.md": flowContextCommandsMd,
    "taskflow-cli-agent-commands.md": agentCommandsMd,
    "taskflow-cli-schedule-commands.md": scheduleCommandsMd,
    "taskflow-cli-session-commands.md": sessionCommandsMd,
    "taskflow-cli-browser-commands.md": browserCommandsMd,
    "taskflow-cli-other-commands.md": otherCommandsMd,
};

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

let resolvedSkillDir: string | undefined;

const PROMPT_BASE = `
You are running inside Taskflow application that orchestrates ai agents and terminal sessions based on tasks and projects. Use taskflow-cli to interact with host app data layer when needed. Any user mention of tasks, projects, flows, actions, schedules, sessions and agents is more likely to refer to taskflow cli than to your internal tools. You may need to read referenced docs to get full list of commands.\n
Project is usually a repo but can be a plain folder.
Task is self explanatory. Tasks can be executed in worktrees.
Action is a prefedined prompt with various agent settings.
Flow is a set of Actions executed one after another.
Session is a cli process running an agent.
Schedule is a recurring cli process running an agent.`;

const PROMPT_TASK_SCOPE = `
This session is scoped to a specific task.
- At session start, read task info.
- Log your findings and progress.
- Log every commit hash when inside task context.
- Log every edited file as path relative to worktree or repo root.`;

const PROMPT_PROJECT_SCOPE = `
This session is scoped to a project, not a specific task.`;

const PROMPT_FLOW = `
This session is scoped to a flow step. Expect instructions that imply or specify flow context commands.`;

export const PROMPT_AUTONOMOUS =
    "Do not ask clarifying questions. Do not ask for confirmation. Make reasonable assumptions and proceed autonomously. If something is ambiguous, choose the most likely interpretation and act on it.";

export function buildSystemPrompt(
    isProjectScope: boolean,
    isFlowScope?: boolean,
    includeSkill = true,
): string {
    const skillBlock = includeSkill
        ? `\n${resolvedSkillDir ? resolveSkillReferences(skillMarkdown, resolvedSkillDir) : skillMarkdown}`
        : "";
    const scopeBlock = isProjectScope ? PROMPT_PROJECT_SCOPE : PROMPT_TASK_SCOPE;
    const flowBlock = isFlowScope ? `\n${PROMPT_FLOW}` : "";
    return `${PROMPT_BASE}${skillBlock}\n${scopeBlock}${flowBlock}`;
}

function escapeTomlBasicString(value: string): string {
    return value
        .replaceAll("\\", "\\\\")
        .replaceAll("\b", "\\b")
        .replaceAll("\t", "\\t")
        .replaceAll("\n", "\\n")
        .replaceAll("\f", "\\f")
        .replaceAll("\r", "\\r")
        .replaceAll('"', '\\"');
}

function resolveSkillReferences(markdown: string, skillDir: string): string {
    return markdown.replace(/^@(taskflow-cli-[\w-]+\.md)$/gm, (_match, filename: string) => {
        return join(skillDir, filename);
    });
}

export async function ensureInternalAgentSkillFile(baseDir: string): Promise<string> {
    const writeSkillFiles = async (rootDir: string): Promise<string> => {
        const skillDir = join(rootDir, SKILL_DIR_NAME);
        const skillPath = join(skillDir, SKILL_FILE_NAME);
        await mkdir(skillDir, { recursive: true });

        // Write each split command file
        const writeOps = Object.entries(COMMAND_FILES).map(([filename, content]) =>
            writeFile(join(skillDir, filename), content, "utf8"),
        );

        // Write main skill file with resolved absolute paths
        const resolved = resolveSkillReferences(skillMarkdown, skillDir);
        writeOps.push(writeFile(skillPath, resolved, "utf8"));

        await Promise.all(writeOps);
        resolvedSkillDir = skillDir;
        return skillPath;
    };

    try {
        return await writeSkillFiles(baseDir);
    } catch {
        return writeSkillFiles(join(tmpdir(), "taskflow-agent-skills"));
    }
}

export function getResolvedCliHelp(): string {
    return skillMarkdown.replace(
        /^@(taskflow-cli-[\w-]+\.md)$/gm,
        (_match, filename: string) => COMMAND_FILES[filename] ?? filename,
    );
}

export async function ensureCliScript(binDir: string): Promise<void> {
    await mkdir(binDir, { recursive: true });

    if (isWindows()) {
        const exePath = join(binDir, "taskflow-cli.exe");
        const batPath = join(binDir, "taskflow-cli.bat");
        let batContent: string;
        try {
            await access(exePath);
            // Packaged mode — exe exists, delegate to it
            batContent = '@echo off\r\n"%~dp0taskflow-cli.exe" %*\r\n';
        } catch {
            // Dev mode — call bun run on the TS source directly
            const tsPath = join(import.meta.dir, "taskflow-cli-bin.ts");
            batContent = `@echo off\r\nbun run "${tsPath}" %*\r\n`;
        }
        await writeFile(batPath, batContent, "utf8");
    } else {
        const scriptPath = join(binDir, "taskflow-cli");
        await writeFile(scriptPath, cliScript, "utf8");
        await chmod(scriptPath, 0o755);
    }
}

export interface ProjectContext {
    prompt?: string;
    linkedProjects?: LinkedProject[];
    resolvedProjects?: Record<string, { name: string; path: string }>;
}

export function buildProjectContextBlock(context: ProjectContext): string | undefined {
    const parts: string[] = [];

    if (context.prompt?.trim()) {
        parts.push(`## Project Instructions\n\n${context.prompt.trim()}`);
    }

    const links = context.linkedProjects;
    if (links && links.length > 0 && context.resolvedProjects) {
        const items: string[] = [];
        for (const link of links) {
            const resolved = context.resolvedProjects[link.projectId];
            if (!resolved) continue;
            const note = link.note.trim() ? ` — "${link.note.trim()}"` : "";
            items.push(`- **${resolved.name}** (${link.projectId}) — ${resolved.path}${note}`);
        }
        if (items.length > 0) {
            parts.push(`## Linked Projects\n\n${items.join("\n")}`);
        }
    }

    return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildAgentLaunchSpec(
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
    additionalSystemPrompt?: string,
    isProjectScope?: boolean,
    isFlowScope?: boolean,
): { command: string; args: string[]; env?: Record<string, string> } {
    // Codex registers the taskflow skill separately via `skills.config`, so exclude
    // it from the embedded prompt to avoid duplicating the skill content.
    const basePrompt = buildSystemPrompt(isProjectScope ?? false, isFlowScope, type !== "codex");
    const systemPrompt = additionalSystemPrompt
        ? `${basePrompt}\n\n${additionalSystemPrompt}`
        : basePrompt;

    if (type === "claude") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "claude") {
            if (
                agentOptions.permissionMode &&
                (CLAUDE_PERMISSION_MODES as readonly string[]).includes(agentOptions.permissionMode)
            )
                optionArgs.push(
                    "--permission-mode",
                    agentOptions.permissionMode === "manual"
                        ? "default"
                        : agentOptions.permissionMode,
                );
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
            if (
                agentOptions.effort &&
                (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(agentOptions.effort)
            )
                optionArgs.push("--effort", agentOptions.effort);
        }
        return {
            command: "claude",
            args: [
                ...optionArgs,
                "--allowedTools",
                `Read(/${dirname(skillPath)}/**)`,
                "--allowedTools",
                "Bash(taskflow-cli*)",
                "--append-system-prompt",
                systemPrompt,
                ...(prompt ? ["--", prompt] : []),
            ],
        };
    }

    if (type === "opencode") {
        const config: Record<string, unknown> = {
            instructions: [skillPath],
        };
        if (agentOptions?.type === "opencode" && agentOptions.autoApprove) {
            config.permission = { edit: "allow", bash: "allow", write: "allow" };
        }

        const args: string[] = [];
        if (agentOptions?.type === "opencode") {
            if (agentOptions.model) args.push("--model", agentOptions.model);
            if (agentOptions.variant) args.push("--variant", agentOptions.variant);
        }
        if (prompt) args.push("--prompt", prompt);

        return {
            command: "opencode",
            args,
            env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        };
    }

    if (type === "gemini") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "gemini") {
            if (agentOptions.approvalMode && agentOptions.approvalMode !== "default")
                optionArgs.push("--approval-mode", agentOptions.approvalMode);
            if (agentOptions.sandbox) optionArgs.push("--sandbox");
            if (agentOptions.model && agentOptions.model !== "default")
                optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "gemini",
            args: [...optionArgs, ...(prompt ? ["--prompt-interactive", prompt] : [])],
        };
    }

    if (type === "cursor") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "cursor") {
            if (agentOptions.yolo) optionArgs.push("--yolo");
            if (agentOptions.model && agentOptions.model !== "default")
                optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "cursor",
            args: ["agent", ...optionArgs, ...(prompt ? ["--", prompt] : [])],
        };
    }

    if (type === "pi") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "pi") {
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
            if (agentOptions.thinking && agentOptions.thinking !== "off")
                optionArgs.push("--thinking", agentOptions.thinking);
            if (agentOptions.tools?.trim()) optionArgs.push("--tools", agentOptions.tools.trim());
        }
        return {
            command: "pi",
            args: [
                ...optionArgs,
                "--append-system-prompt",
                systemPrompt,
                ...(prompt ? [prompt] : []),
            ],
        };
    }

    const optionArgs: string[] = [];
    if (agentOptions?.type === "codex") {
        if (agentOptions.dangerouslyBypassApprovalsAndSandbox) {
            optionArgs.push("--dangerously-bypass-approvals-and-sandbox");
        } else {
            if (
                agentOptions.sandbox &&
                (CODEX_SANDBOX_MODES as readonly string[]).includes(agentOptions.sandbox)
            )
                optionArgs.push("--sandbox", agentOptions.sandbox);
            if (
                agentOptions.approvalPolicy &&
                (CODEX_APPROVAL_POLICIES as readonly string[]).includes(agentOptions.approvalPolicy)
            )
                optionArgs.push("--ask-for-approval", agentOptions.approvalPolicy);
        }
        if (agentOptions.model && agentOptions.model !== "default")
            optionArgs.push("--model", agentOptions.model);
        if (
            agentOptions.reasoningEffort &&
            (CODEX_REASONING_EFFORTS as readonly string[]).includes(agentOptions.reasoningEffort)
        )
            optionArgs.push(
                "-c",
                `model_reasoning_effort="${escapeTomlBasicString(agentOptions.reasoningEffort)}"`,
            );
    }
    return {
        command: "codex",
        args: [
            ...optionArgs,
            "-c",
            `developer_instructions="${escapeTomlBasicString(systemPrompt)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? ["--", prompt] : []),
        ],
    };
}
