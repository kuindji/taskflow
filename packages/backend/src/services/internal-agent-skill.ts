import { chmod, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import cliScript from "./taskflow-cli.sh" with { type: "text" };
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

export function buildSystemPrompt(isProjectScope: boolean, isFlowScope?: boolean): string {
    const skill = resolvedSkillDir
        ? resolveSkillReferences(skillMarkdown, resolvedSkillDir)
        : skillMarkdown;
    const scopeBlock = isProjectScope ? PROMPT_PROJECT_SCOPE : PROMPT_TASK_SCOPE;
    const flowBlock = isFlowScope ? `\n${PROMPT_FLOW}` : "";
    return `${PROMPT_BASE}\n${skill}\n${scopeBlock}${flowBlock}`;
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
    const scriptPath = join(binDir, "taskflow-cli");
    await mkdir(binDir, { recursive: true });
    await writeFile(scriptPath, cliScript, "utf8");
    await chmod(scriptPath, 0o755);
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
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
    additionalSystemPrompt?: string,
    isProjectScope?: boolean,
    isFlowScope?: boolean,
): { command: string; args: string[]; env?: Record<string, string> } {
    const basePrompt = buildSystemPrompt(isProjectScope ?? false, isFlowScope);
    const systemPrompt = additionalSystemPrompt
        ? `${basePrompt}\n\n${additionalSystemPrompt}`
        : basePrompt;

    if (type === "claude") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "claude") {
            if (agentOptions.dangerouslySkipPermissions)
                optionArgs.push("--dangerously-skip-permissions");
            if (agentOptions.permissionMode && agentOptions.permissionMode !== "default")
                optionArgs.push("--permission-mode", agentOptions.permissionMode);
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
            if (agentOptions.effort) optionArgs.push("--effort", agentOptions.effort);
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
        if (
            agentOptions?.type === "opencode" &&
            (agentOptions.fullAccess || agentOptions.dontAskQuestions)
        ) {
            config.permission = { edit: "allow", bash: "allow", write: "allow" };
        }

        const args: string[] = [];
        if (agentOptions?.type === "opencode" && agentOptions.model) {
            args.push("--model", agentOptions.model);
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
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "gemini",
            args: [...optionArgs, ...(prompt ? ["--prompt-interactive", prompt] : [])],
        };
    }

    if (type === "cursor") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "cursor") {
            if (agentOptions.fullAccess || agentOptions.dontAskQuestions) optionArgs.push("--yolo");
            if (agentOptions.model && agentOptions.model !== "default")
                optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "cursor",
            args: ["agent", ...optionArgs, ...(prompt ? ["--", prompt] : [])],
        };
    }

    const optionArgs: string[] = [];
    if (agentOptions?.type === "codex") {
        if (agentOptions.fullAuto) {
            optionArgs.push("--full-auto");
        } else {
            if (agentOptions.sandbox) optionArgs.push("--sandbox", agentOptions.sandbox);
            if (agentOptions.approvalPolicy)
                optionArgs.push("--ask-for-approval", agentOptions.approvalPolicy);
        }
        if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
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
