/** Where a file-open request should land. */
type FileOpenPlan =
    | { kind: "markdown"; mode: "preview" | "edit"; line?: number }
    | { kind: "monaco"; line?: number }
    | { kind: "cli-editor"; line?: number };

const MARKDOWN_EXTENSIONS = [".md", ".markdown"];

function isMarkdownPath(filePath: string): boolean {
    const lower = filePath.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

interface PlanFileOpenArgs {
    filePath: string;
    line?: number;
    internalEditor: string;
    editorAvailable: boolean;
}

/**
 * Preview cannot honour "line 214", so a markdown open that carries a line
 * number goes to the tab's own edit mode. That holds even when a CLI editor is
 * configured: the design routes search hits and terminal `file:line` links into
 * the markdown tab, and reserves the CLI-editor handoff for the Edit button.
 */
function planFileOpen({
    filePath,
    line,
    internalEditor,
    editorAvailable,
}: PlanFileOpenArgs): FileOpenPlan {
    const useCliEditor = internalEditor !== "monaco" && editorAvailable;

    if (isMarkdownPath(filePath)) {
        if (line === undefined) return { kind: "markdown", mode: "preview" };
        return { kind: "markdown", mode: "edit", line };
    }

    if (!useCliEditor) return line === undefined ? { kind: "monaco" } : { kind: "monaco", line };
    return line === undefined ? { kind: "cli-editor" } : { kind: "cli-editor", line };
}

export type { FileOpenPlan };
export { isMarkdownPath, planFileOpen };
