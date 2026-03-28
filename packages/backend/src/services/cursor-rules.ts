import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { buildSystemPrompt } from "./internal-agent-skill";

const CURSOR_RULES_DIR = ".cursor/rules";
const CURSOR_RULES_FILE = "taskflow.mdc";

function buildCursorRulesContent(): string {
    return `---
description: Taskflow CLI integration — provides taskflow-cli for logging, browser tabs, and task context
alwaysApply: true
---

${buildSystemPrompt(false)}
`;
}

export async function checkCursorRulesStatus(cwd: string): Promise<"missing" | "present"> {
    const filePath = join(cwd, CURSOR_RULES_DIR, CURSOR_RULES_FILE);
    try {
        const content = await readFile(filePath, "utf-8");
        return content.includes("taskflow-cli") ? "present" : "missing";
    } catch {
        return "missing";
    }
}

export async function ensureCursorRulesFile(cwd: string, additionalPrompt?: string): Promise<void> {
    const dirPath = join(cwd, CURSOR_RULES_DIR);
    const filePath = join(dirPath, CURSOR_RULES_FILE);
    const rulesContent = buildCursorRulesContent();
    const content = additionalPrompt
        ? `${rulesContent}\n${additionalPrompt}\n`
        : rulesContent;
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, content, "utf-8");
}
