import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { buildSystemPrompt } from "./internal-agent-skill";

const GEMINI_SYSTEM_DIR = "gemini-system-prompt";
const GEMINI_SYSTEM_FILE = "SYSTEM.md";

async function writeSystemFile(rootDir: string, content: string): Promise<string> {
    const dir = join(rootDir, GEMINI_SYSTEM_DIR);
    const filePath = join(dir, GEMINI_SYSTEM_FILE);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, "utf-8");
    return filePath;
}

export async function ensureGeminiSystemFile(
    baseDir: string,
    isProjectScope: boolean,
    additionalPrompt?: string,
): Promise<string> {
    const basePrompt = buildSystemPrompt(isProjectScope);
    const content = additionalPrompt
        ? `${basePrompt}\n\n${additionalPrompt}\n`
        : `${basePrompt}\n`;

    try {
        return await writeSystemFile(baseDir, content);
    } catch {
        return writeSystemFile(join(tmpdir(), "taskflow-agent-skills"), content);
    }
}
