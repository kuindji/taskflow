import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const ERROR_START = "# --- taskflow validation errors ---";
const ERROR_END = "# --- end taskflow validation errors ---";

interface EditorFilesystem {
    mkdtemp(prefix: string): Promise<string>;
    readFile(path: string, encoding: "utf8"): Promise<string>;
    writeFile(path: string, contents: string): Promise<void>;
    rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

interface RendererControls {
    suspend(): void | Promise<void>;
    resume(): void | Promise<void>;
    requestRender(): void;
}

interface ExternalEditorDeps {
    filesystem: EditorFilesystem;
    renderer: RendererControls;
    editor: string;
    tempRoot: string;
    blur(): void;
    restoreFocus(): void;
    runEditor(command: string, args: string[], file: string): Promise<number>;
}

interface EditRecordOptions<T> {
    filename: string;
    initialContents: string;
    validate(contents: string): T;
    save(value: T): Promise<void>;
    deps: ExternalEditorDeps;
}

function splitCommand(command: string): string[] {
    const parts: string[] = [];
    const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s]+)/g;
    for (const match of command.matchAll(pattern)) {
        parts.push((match[1] ?? match[2] ?? match[3] ?? "").replace(/\\([\\"])/g, "$1"));
    }
    return parts;
}

async function defaultRunEditor(command: string, args: string[], file: string): Promise<number> {
    const process = Bun.spawn([command, ...args, file], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    return process.exited;
}

function defaultExternalEditorDeps(
    renderer: RendererControls,
    blur: () => void,
    restoreFocus: () => void,
): ExternalEditorDeps {
    return {
        filesystem: { mkdtemp, readFile, rm, writeFile },
        renderer,
        editor: "vi",
        tempRoot: tmpdir(),
        blur,
        restoreFocus,
        runEditor: defaultRunEditor,
    };
}

function validationMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function withValidationError(contents: string, message: string): string {
    const existing = new RegExp(
        `^${ERROR_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?${ERROR_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    );
    const body = contents.replace(existing, "");
    const comments = message
        .split("\n")
        .map((line) => `# ${line}`)
        .join("\n");
    return `${ERROR_START}\n${comments}\n${ERROR_END}\n${body}`;
}

async function invokeEditor(file: string, deps: ExternalEditorDeps): Promise<number> {
    const commandParts = splitCommand(deps.editor.trim() || "vi");
    const command = commandParts.shift() ?? "vi";
    deps.blur();
    let suspended = false;
    try {
        await deps.renderer.suspend();
        suspended = true;
        return await deps.runEditor(command, commandParts, file);
    } finally {
        if (suspended) await deps.renderer.resume();
        deps.restoreFocus();
        deps.renderer.requestRender();
    }
}

async function editRecord<T>(options: EditRecordOptions<T>): Promise<T | null> {
    const { deps } = options;
    const directory = await deps.filesystem.mkdtemp(join(deps.tempRoot, "taskflow-tui-editor-"));
    const file = join(directory, options.filename);
    try {
        await deps.filesystem.writeFile(file, options.initialContents);
        while (true) {
            const exitCode = await invokeEditor(file, deps);
            if (exitCode !== 0) return null;
            const contents = await deps.filesystem.readFile(file, "utf8");
            try {
                const value = options.validate(contents);
                await options.save(value);
                return value;
            } catch (error) {
                await deps.filesystem.writeFile(
                    file,
                    withValidationError(contents, validationMessage(error)),
                );
            }
        }
    } finally {
        await deps.filesystem.rm(directory, { recursive: true, force: true });
    }
}

export { defaultExternalEditorDeps, editRecord, splitCommand, withValidationError };
export type { EditRecordOptions, EditorFilesystem, ExternalEditorDeps, RendererControls };
