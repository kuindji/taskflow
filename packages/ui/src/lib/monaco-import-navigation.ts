import * as monaco from "monaco-editor";
import { MSG } from "@taskflow/shared";
import type {
    TsResolveTsconfigResponse,
    TsResolveImportResponse,
} from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

const TS_LANGUAGES = new Set(["typescript", "javascript"]);

/** Tracks the tsconfig path currently applied to Monaco's compiler options */
let activeTsconfigPath: string | null | undefined;

/** Cache: directory → tsconfig path (avoids repeated backend calls) */
const dirTsconfigCache = new Map<string, string | null>();

/** Cache: tsconfig path → compiler options (avoids re-fetching when switching between zones) */
const tsconfigOptionsCache = new Map<string, Record<string, unknown>>();

function buildMonacoOpts(opts: Record<string, unknown>): monaco.languages.typescript.CompilerOptions {
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
        result = await sendRequest<TsResolveTsconfigResponse>(
            MSG.TS_RESOLVE_TSCONFIG,
            { filePath },
        );
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

/**
 * Extract the import specifier string from the line at the cursor position.
 * Handles: import ... from "specifier", import "specifier", require("specifier")
 */
function extractImportSpecifier(lineContent: string): string | null {
    // Match: from "..." or from '...'
    const fromMatch = lineContent.match(/from\s+['"]([^'"]+)['"]/);
    if (fromMatch) return fromMatch[1];

    // Match: import "..." or import '...'
    const importMatch = lineContent.match(/import\s+['"]([^'"]+)['"]/);
    if (importMatch) return importMatch[1];

    // Match: require("...") or require('...')
    const requireMatch = lineContent.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch) return requireMatch[1];

    return null;
}

/** Open a resolved file path in a new editor tab */
type OpenFileCallback = (filePath: string) => void;

const definitionProviderDisposables: monaco.IDisposable[] = [];

/**
 * Register the Monaco definition provider for Cmd+click import navigation.
 * Call this once on app startup. The `openFile` callback is called when
 * a definition is resolved to a file path.
 */
function registerDefinitionProvider(openFile: OpenFileCallback): void {
    if (definitionProviderDisposables.length > 0) return;

    const provider: monaco.languages.DefinitionProvider = {
        provideDefinition: async (
            model: monaco.editor.ITextModel,
            position: monaco.Position,
        ): Promise<monaco.languages.Definition | null> => {
            const language = model.getLanguageId();
            if (!TS_LANGUAGES.has(language)) return null;

            const uri = model.uri;
            const filePath = uri.path;

            // First: try Monaco's built-in TypeScript worker
            const workerGetter = language === "typescript"
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
                    const def = definitions[0];
                    const defUri = monaco.Uri.parse(def.fileName);
                    const defModel = monaco.editor.getModel(defUri);

                    // If the definition is in a different file, open it
                    if (defUri.path !== filePath) {
                        openFile(defUri.path);
                        return null;
                    }

                    // If it's in the same file, return the location for Monaco to navigate
                    if (defModel) {
                        const startPos = defModel.getPositionAt(def.textSpan.start);
                        const endPos = defModel.getPositionAt(
                            def.textSpan.start + def.textSpan.length,
                        );
                        return {
                            uri: defUri,
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
                // Worker failed — fall through to backend resolution
            }

            // Fallback: extract import specifier and ask backend
            const lineContent = model.getLineContent(position.lineNumber);
            const specifier = extractImportSpecifier(lineContent);
            if (!specifier) return null;

            try {
                const result = await sendRequest<TsResolveImportResponse>(
                    MSG.TS_RESOLVE_IMPORT,
                    { sourceFilePath: filePath, importSpecifier: specifier },
                );
                if (result.resolvedPath) {
                    openFile(result.resolvedPath);
                }
            } catch {
                // Resolution failed — nothing to navigate to
            }

            return null;
        },
    };

    definitionProviderDisposables.push(
        monaco.languages.registerDefinitionProvider("typescript", provider),
        monaco.languages.registerDefinitionProvider("javascript", provider),
    );
}

export { syncCompilerOptions, registerDefinitionProvider };
