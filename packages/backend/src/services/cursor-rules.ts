import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { INTERNAL_AGENT_SYSTEM_PROMPT } from "./internal-agent-skill";

const CURSOR_RULES_DIR = ".cursor/rules";
const CURSOR_RULES_FILE = "taskflow.mdc";
const CURSOR_RULES_MARKER = "taskflow-cli";

const CURSOR_RULES_CONTENT = `---
description: Taskflow CLI integration — provides taskflow-cli for logging, browser tabs, and task context
alwaysApply: true
---

${INTERNAL_AGENT_SYSTEM_PROMPT}
`;

export async function checkCursorRulesStatus(cwd: string): Promise<"missing" | "present"> {
    const filePath = join(cwd, CURSOR_RULES_DIR, CURSOR_RULES_FILE);
    try {
        const content = await readFile(filePath, "utf-8");
        return content.includes(CURSOR_RULES_MARKER) ? "present" : "missing";
    } catch {
        return "missing";
    }
}

export async function ensureCursorRulesFile(cwd: string, additionalPrompt?: string): Promise<void> {
    const dirPath = join(cwd, CURSOR_RULES_DIR);
    const filePath = join(dirPath, CURSOR_RULES_FILE);
    const content = additionalPrompt
        ? `${CURSOR_RULES_CONTENT}\n${additionalPrompt}\n`
        : CURSOR_RULES_CONTENT;
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, content, "utf-8");
}
