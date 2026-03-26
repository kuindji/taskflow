import * as monaco from "monaco-editor";
import { MSG } from "@taskflow/shared";
import type { TsResolveTsconfigResponse, TsResolveImportResponse } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

const TS_LANGUAGES = new Set(["typescript", "javascript"]);

/** Tracks the tsconfig path currently applied to Monaco's compiler options */
let activeTsconfigPath: string | null | undefined;

/** Cache: directory → tsconfig path (avoids repeated backend calls) */
const dirTsconfigCache = new Map<string, string | null>();

/** Cache: tsconfig path → compiler options (avoids re-fetching when switching between zones) */
const tsconfigOptionsCache = new Map<string, Record<string, unknown>>();

function buildMonacoOpts(
    opts: Record<string, unknown>,
): monaco.languages.typescript.CompilerOptions {
    const monacoOpts: monaco.languages.typescript.CompilerOptions = {
        allowJs: true,
        allowNonTsExtensions: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    };

    if (typeof opts.baseUrl === "string") monacoOpts.baseUrl = opts.baseUrl;
    if (typeof opts.strict === "boolean") monacoOpts.strict = opts.strict;
    if (typeof opts.rootDir === "string") monacoOpts.rootDir = opts.rootDir;
    if (Array.isArray(opts.rootDirs)) monacoOpts.rootDirs = opts.rootDirs;
    if (opts.paths !== null && typeof opts.paths === "object" && !Array.isArray(opts.paths)) {
        monacoOpts.paths = opts.paths as Record<string, string[]>;
    }

    return monacoOpts;
}

function applyCompilerOptions(opts: Record<string, unknown>): void {
    const monacoOpts = buildMonacoOpts(opts);
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(monacoOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(monacoOpts);
}

/**
 * Sync Monaco's TypeScript compiler options with the nearest tsconfig for the given file.
 * Only calls the backend if the file's directory hasn't been seen before.
 */
async function syncCompilerOptions(filePath: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));

    // Check if we've already resolved this directory
    const cachedPath = dirTsconfigCache.get(dir);
    if (cachedPath !== undefined) {
        if (cachedPath === activeTsconfigPath) return;
        // Different tsconfig — apply cached options if available
        activeTsconfigPath = cachedPath;
        if (cachedPath !== null) {
            const cachedOpts = tsconfigOptionsCache.get(cachedPath);
            if (cachedOpts) {
                applyCompilerOptions(cachedOpts);
                return;
            }
        }
    }

    let result: TsResolveTsconfigResponse;
    try {
        result = await sendRequest<TsResolveTsconfigResponse>(MSG.TS_RESOLVE_TSCONFIG, {
            filePath,
        });
    } catch {
        return;
    }

    dirTsconfigCache.set(dir, result.tsconfigPath);

    if (result.tsconfigPath === activeTsconfigPath) return;
    activeTsconfigPath = result.tsconfigPath;

    if (!result.tsconfigPath) return;

    tsconfigOptionsCache.set(result.tsconfigPath, result.compilerOptions);
    applyCompilerOptions(result.compilerOptions);
}

interface ImportSpecifierMatch {
    specifier: string;
    /** 1-based start column of the specifier (inside the quotes) */
    startColumn: number;
    /** 1-based end column (exclusive) of the specifier */
    endColumn: number;
}

/**
 * Extract the import specifier string and its column range from a line.
 * Handles: import ... from "specifier", import "specifier", require("specifier")
 */
function extractImportSpecifier(lineContent: string): ImportSpecifierMatch | null {
    const patterns = [
        /from\s+['"]([^'"]+)['"]/,
        /import\s+['"]([^'"]+)['"]/,
        /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
    ];

    for (const pattern of patterns) {
        const match = lineContent.match(pattern);
        if (match) {
            const fullMatchStart = match.index!;
            const specifier = match[1];
            // Find the specifier within the full match (after the opening quote)
            const specifierOffset = match[0].indexOf(specifier);
            const startColumn = fullMatchStart + specifierOffset + 1; // 1-based
            return {
                specifier,
                startColumn,
                endColumn: startColumn + specifier.length,
            };
        }
    }

    return null;
}

/**
 * Ensure a Monaco model exists for the given file URI so that
 * Monaco's GotoDefinitionAtPosition contribution can resolve it
 * and show the definition link underline. Without a model, the
 * contribution silently skips adding the underline decoration.
 */
function ensureModel(fileUri: monaco.Uri): void {
    if (!monaco.editor.getModel(fileUri)) {
        // Create a placeholder model. It will be replaced with real
        // content if/when the user actually opens the file.
        monaco.editor.createModel("", undefined, fileUri);
    }
}

/** Open a resolved file path in a new editor tab */
type OpenFileCallback = (filePath: string) => void;

const registeredDisposables: monaco.IDisposable[] = [];

/**
 * Register Monaco definition provider and editor opener for Cmd+click import navigation.
 *
 * The definition provider returns Location objects pointing to the target file.
 * Monaco calls provideDefinition on hover (to show the underline) — returning a
 * Location has no side effects. The actual file opening happens only on click,
 * when Monaco invokes the registered EditorOpener with the resolved URI.
 */
function registerImportNavigation(openFile: OpenFileCallback): void {
    if (registeredDisposables.length > 0) return;

    // EditorOpener: intercepts "go to definition" when the target is a different file.
    // This is called only on actual Cmd+click, not during hover preview.
    registeredDisposables.push(
        monaco.editor.registerEditorOpener({
            openCodeEditor(_source, resource) {
                openFile(resource.path);
                return true;
            },
        }),
    );

    const provider: monaco.languages.DefinitionProvider = {
        provideDefinition: async (
            model: monaco.editor.ITextModel,
            position: monaco.Position,
        ): Promise<monaco.languages.LocationLink[] | monaco.languages.Definition | null> => {
            const language = model.getLanguageId();
            if (!TS_LANGUAGES.has(language)) return null;

            const uri = model.uri;
            const filePath = uri.path;

            // For import statements, always use backend resolution.
            // The Monaco TS worker doesn't have filesystem access so it can't
            // resolve imports to files that aren't loaded as models.
            const lineContent = model.getLineContent(position.lineNumber);
            const importMatch = extractImportSpecifier(lineContent);
            if (importMatch) {
                try {
                    const result = await sendRequest<TsResolveImportResponse>(
                        MSG.TS_RESOLVE_IMPORT,
                        { sourceFilePath: filePath, importSpecifier: importMatch.specifier },
                    );
                    if (result.resolvedPath) {
                        const targetUri = monaco.Uri.file(result.resolvedPath);
                        ensureModel(targetUri);
                        const line = position.lineNumber;
                        const link: monaco.languages.LocationLink = {
                            originSelectionRange: new monaco.Range(
                                line,
                                importMatch.startColumn,
                                line,
                                importMatch.endColumn,
                            ),
                            uri: targetUri,
                            range: new monaco.Range(1, 1, 1, 1),
                        };
                        return [link];
                    }
                } catch {
                    // Resolution failed — nothing to navigate to
                }
                return null;
            }

            // For non-import positions (local symbols), use the TS worker
            // for same-file go-to-definition
            const workerGetter =
                language === "typescript"
                    ? monaco.languages.typescript.getTypeScriptWorker
                    : monaco.languages.typescript.getJavaScriptWorker;

            try {
                const worker = await workerGetter();
                const client = await worker(uri);
                const definitions = await client.getDefinitionAtPosition(
                    uri.toString(),
                    model.getOffsetAt(position),
                );

                if (definitions && definitions.length > 0) {
                    const def = definitions[0] as {
                        fileName: string;
                        textSpan: { start: number; length: number };
                    };
                    const defUri = monaco.Uri.parse(def.fileName);

                    // Same-file definition: navigate within the editor
                    if (defUri.path === filePath) {
                        const startPos = model.getPositionAt(def.textSpan.start);
                        const endPos = model.getPositionAt(
                            def.textSpan.start + def.textSpan.length,
                        );
                        return {
                            uri,
                            range: new monaco.Range(
                                startPos.lineNumber,
                                startPos.column,
                                endPos.lineNumber,
                                endPos.column,
                            ),
                        };
                    }
                }
            } catch {
                // Worker failed
            }

            return null;
        },
    };

    registeredDisposables.push(
        monaco.languages.registerDefinitionProvider("typescript", provider),
        monaco.languages.registerDefinitionProvider("javascript", provider),
    );
}

export { syncCompilerOptions, registerImportNavigation };
