import { chmod, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import cliScript from "./taskflow-cli.sh" with { type: "text" };
import skillMarkdown from "./taskflow-cli-skill.md" with { type: "text" };
import type { AgentLaunchOptions } from "@taskflow/shared";

const SKILL_DIR_NAME = "taskflow-internal-api";
const SKILL_FILE_NAME = "SKILL.md";

const PROMPT_BASE = `
You are running inside Taskflow application that orchestrates ai agent and terminal sessions based on tasks and projects. Use taskflow-cli to interact with host app data layer when needed. Any user mention of tasks, projects and flows is more likely to refer to taskflow cli than to your internal tools.`;

const PROMPT_TASK_SCOPE = `
This session is scoped to a specific task.
- At session start, read task info.
- Log your findings and progress.
- Log every commit hash when inside task context.`;

const PROMPT_PROJECT_SCOPE = `
This session is scoped to a project, not a specific task.`;

const PROMPT_FLOW = `
This session is scoped to a flow step. Expect instructions that imply or specify taskflow-cli usage.`;

export function buildSystemPrompt(isProjectScope: boolean, isFlowScope?: boolean): string {
    const scopeBlock = isProjectScope ? PROMPT_PROJECT_SCOPE : PROMPT_TASK_SCOPE;
    const flowBlock = isFlowScope ? `\n${PROMPT_FLOW}` : "";
    return `${PROMPT_BASE}\n${skillMarkdown}\n${scopeBlock}${flowBlock}`;
}

/** @deprecated Use buildSystemPrompt() instead. Kept for tests that assert on common content. */
export const INTERNAL_AGENT_SYSTEM_PROMPT = buildSystemPrompt(false);

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

export async function ensureInternalAgentSkillFile(baseDir: string): Promise<string> {
    const writeSkillFile = async (rootDir: string): Promise<string> => {
        const skillDir = join(rootDir, SKILL_DIR_NAME);
        const skillPath = join(skillDir, SKILL_FILE_NAME);
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillPath, skillMarkdown, "utf8");
        return skillPath;
    };

    try {
        return await writeSkillFile(baseDir);
    } catch {
        return writeSkillFile(join(tmpdir(), "taskflow-agent-skills"));
    }
}

export async function ensureCliScript(binDir: string): Promise<void> {
    const scriptPath = join(binDir, "taskflow-cli");
    await mkdir(binDir, { recursive: true });
    await writeFile(scriptPath, cliScript, "utf8");
    await chmod(scriptPath, 0o755);
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
            if (agentOptions.fullAccess) optionArgs.push("--dangerously-skip-permissions");
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "claude",
            args: [
                ...optionArgs,
                "--allowedTools",
                "Bash(taskflow-cli*)",
                "--append-system-prompt",
                systemPrompt,
                ...(prompt ? [prompt] : []),
            ],
        };
    }

    if (type === "opencode") {
        const config: Record<string, unknown> = {
            instructions: [skillPath],
        };
        if (agentOptions?.type === "opencode" && agentOptions.fullAccess) {
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
            if (agentOptions.fullAccess) optionArgs.push("--yolo");
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
            if (agentOptions.fullAccess) optionArgs.push("--yolo");
            if (agentOptions.model && agentOptions.model !== "default")
                optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "cursor",
            args: ["agent", ...optionArgs, ...(prompt ? [prompt] : [])],
        };
    }

    const optionArgs: string[] = [];
    if (agentOptions?.type === "codex") {
        if (agentOptions.fullAccess) optionArgs.push("--full-auto");
    }
    return {
        command: "codex",
        args: [
            ...optionArgs,
            "-c",
            `developer_instructions="${escapeTomlBasicString(systemPrompt)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? [prompt] : []),
        ],
    };
}
