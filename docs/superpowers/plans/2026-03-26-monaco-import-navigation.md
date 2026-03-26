# Monaco Import Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Cmd+click on TS/JS imports in Monaco editor to open the target file in a new editor tab, using TypeScript's own module resolution.

**Architecture:** Backend service loads the project's TypeScript (or a bundled fallback) to find tsconfig files and resolve import specifiers. Frontend registers a Monaco `DefinitionProvider` that first tries the built-in TypeScript worker, then falls back to backend resolution. Compiler options are synced from the nearest tsconfig when the active file changes.

**Tech Stack:** TypeScript (bundled as backend dependency), Monaco editor API, Bun WebSocket handlers

---

## File Structure

### New Files
- `packages/backend/src/services/typescript-resolver.ts` — TypeScript loading, tsconfig discovery, import resolution
- `packages/backend/src/handlers/typescript.ts` — WebSocket handlers for `tsconfig:resolve` and `import:resolve`
- `packages/ui/src/lib/monaco-import-navigation.ts` — Definition provider registration and compiler options sync

### Modified Files
- `packages/shared/src/constants.ts` — Add MSG constants for new message types
- `packages/shared/src/types/ws.ts` — Add payload/response types
- `packages/backend/src/index.ts` — Register TypeScript handlers
- `packages/backend/package.json` — Add `typescript` as dependency
- `packages/ui/src/components/panes/EditorPaneImpl.tsx` — Integrate import navigation on editor mount

---

### Task 1: Add Shared Types and Constants

**Files:**
- Modify: `packages/shared/src/constants.ts:56` (after FILE_REVEAL)
- Modify: `packages/shared/src/types/ws.ts` (append at end)

- [ ] **Step 1: Add MSG constants**

In `packages/shared/src/constants.ts`, add after the `FILE_REVEAL` line (line 56):

```typescript
    // TypeScript resolution
    TS_RESOLVE_TSCONFIG: "ts:resolve-tsconfig",
    TS_RESOLVE_IMPORT: "ts:resolve-import",
```

- [ ] **Step 2: Add payload and response types**

In `packages/shared/src/types/ws.ts`, append at the end of the file:

```typescript
// TypeScript resolution
export interface TsResolveTsconfigPayload {
    filePath: string;
}

export interface TsResolveTsconfigResponse {
    tsconfigPath: string | null;
    compilerOptions: Record<string, unknown>;
}

export interface TsResolveImportPayload {
    sourceFilePath: string;
    importSpecifier: string;
}

export interface TsResolveImportResponse {
    resolvedPath: string | null;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd packages/shared && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add shared types and constants for TypeScript import resolution"
```

---

### Task 2: Create TypeScript Resolver Service

**Files:**
- Create: `packages/backend/src/services/typescript-resolver.ts`
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Add TypeScript as backend dependency**

```bash
cd packages/backend && bun add typescript
```

- [ ] **Step 2: Create the TypeScript resolver service**

Create `packages/backend/src/services/typescript-resolver.ts`:

```typescript
import { resolve, dirname } from "path";
import { access } from "fs/promises";
import ts from "typescript";

/** Cache of parsed tsconfig results keyed by tsconfig file path */
const tsconfigCache = new Map<string, {
    compilerOptions: ts.CompilerOptions;
    raw: Record<string, unknown>;
}>();

/** Cache of directory → tsconfig path mapping so we don't re-walk for sibling files */
const dirToTsconfigPath = new Map<string, string | null>();

/**
 * Try to load TypeScript from the project's node_modules.
 * Falls back to the bundled version (imported at top of this file).
 */
async function loadProjectTs(projectRoot: string): Promise<typeof ts> {
    const projectTsPath = resolve(projectRoot, "node_modules", "typescript");
    try {
        await access(resolve(projectTsPath, "lib", "typescript.js"));
        // Dynamic import of the project's TypeScript
        const projectTs = await import(resolve(projectTsPath, "lib", "typescript.js"));
        return projectTs.default ?? projectTs;
    } catch {
        return ts;
    }
}

/** Cache of project root → TypeScript instance */
const tsInstanceCache = new Map<string, typeof ts>();

async function getTsForProject(filePath: string): Promise<typeof ts> {
    // Walk up to find the nearest directory with node_modules/typescript
    let dir = dirname(filePath);
    while (dir !== dirname(dir)) {
        if (tsInstanceCache.has(dir)) {
            return tsInstanceCache.get(dir)!;
        }
        try {
            await access(resolve(dir, "node_modules", "typescript", "lib", "typescript.js"));
            const instance = await loadProjectTs(dir);
            tsInstanceCache.set(dir, instance);
            return instance;
        } catch {
            dir = dirname(dir);
        }
    }
    return ts;
}

/**
 * Find and parse the nearest tsconfig.json for a given file path.
 * Uses TypeScript's own `findConfigFile` and `readConfigFile`.
 */
export async function resolveTsconfig(filePath: string): Promise<{
    tsconfigPath: string | null;
    compilerOptions: Record<string, unknown>;
}> {
    const dir = dirname(filePath);

    // Check directory cache first
    if (dirToTsconfigPath.has(dir)) {
        const cachedPath = dirToTsconfigPath.get(dir)!;
        if (cachedPath === null) {
            return { tsconfigPath: null, compilerOptions: {} };
        }
        const cached = tsconfigCache.get(cachedPath);
        if (cached) {
            return { tsconfigPath: cachedPath, compilerOptions: cached.raw };
        }
    }

    const tsInstance = await getTsForProject(filePath);

    const tsconfigPath = tsInstance.findConfigFile(
        dir,
        tsInstance.sys.fileExists,
        "tsconfig.json",
    );

    if (!tsconfigPath) {
        dirToTsconfigPath.set(dir, null);
        return { tsconfigPath: null, compilerOptions: {} };
    }

    // Check tsconfig cache
    if (tsconfigCache.has(tsconfigPath)) {
        dirToTsconfigPath.set(dir, tsconfigPath);
        const cached = tsconfigCache.get(tsconfigPath)!;
        return { tsconfigPath, compilerOptions: cached.raw };
    }

    // Parse the tsconfig
    const configFile = tsInstance.readConfigFile(tsconfigPath, tsInstance.sys.readFile);
    if (configFile.error) {
        dirToTsconfigPath.set(dir, null);
        return { tsconfigPath: null, compilerOptions: {} };
    }

    const parsed = tsInstance.parseJsonConfigFileContent(
        configFile.config,
        tsInstance.sys,
        dirname(tsconfigPath),
    );

    // Extract a serializable subset of compiler options for Monaco
    const raw = configFile.config?.compilerOptions ?? {};

    tsconfigCache.set(tsconfigPath, {
        compilerOptions: parsed.options,
        raw,
    });
    dirToTsconfigPath.set(dir, tsconfigPath);

    return { tsconfigPath, compilerOptions: raw };
}

/**
 * Resolve an import specifier from a source file to an absolute file path.
 * Uses TypeScript's `resolveModuleName` with the nearest tsconfig's compiler options.
 */
export async function resolveImport(
    sourceFilePath: string,
    importSpecifier: string,
): Promise<string | null> {
    const tsInstance = await getTsForProject(sourceFilePath);

    // Get compiler options from nearest tsconfig
    const { tsconfigPath } = await resolveTsconfig(sourceFilePath);
    const compilerOptions = tsconfigPath
        ? tsconfigCache.get(tsconfigPath)?.compilerOptions ?? {}
        : {};

    const result = tsInstance.resolveModuleName(
        importSpecifier,
        sourceFilePath,
        compilerOptions,
        tsInstance.sys,
    );

    if (result.resolvedModule) {
        return result.resolvedModule.resolvedFileName;
    }

    return null;
}

/**
 * Clear all caches. Useful if tsconfig files change on disk.
 */
export function clearTsResolverCaches(): void {
    tsconfigCache.clear();
    dirToTsconfigPath.clear();
    tsInstanceCache.clear();
}
```

- [ ] **Step 3: Verify the service compiles**

Run: `cd packages/backend && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/typescript-resolver.ts packages/backend/package.json
git commit -m "feat: add TypeScript resolver service for tsconfig and import resolution"
```

---

### Task 3: Create Backend WebSocket Handlers

**Files:**
- Create: `packages/backend/src/handlers/typescript.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create the TypeScript handler module**

Create `packages/backend/src/handlers/typescript.ts`:

```typescript
import { MSG } from "@taskflow/shared";
import type {
    TsResolveTsconfigPayload,
    TsResolveImportPayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { assertWorkspacePath } from "../utils/path-validation";
import { resolveTsconfig, resolveImport } from "../services/typescript-resolver";

interface TypeScriptHandlerDeps {
    router: Router;
    taskStore: TaskStore;
}

export function registerTypeScriptHandlers(deps: TypeScriptHandlerDeps): void {
    const { router, taskStore } = deps;

    router.register(MSG.TS_RESOLVE_TSCONFIG, async (payload) => {
        const { filePath } = payload as TsResolveTsconfigPayload;
        await assertWorkspacePath(taskStore, filePath);
        const result = await resolveTsconfig(filePath);
        return result;
    });

    router.register(MSG.TS_RESOLVE_IMPORT, async (payload) => {
        const { sourceFilePath, importSpecifier } = payload as TsResolveImportPayload;
        await assertWorkspacePath(taskStore, sourceFilePath);
        const resolvedPath = await resolveImport(sourceFilePath, importSpecifier);
        return { resolvedPath };
    });
}
```

- [ ] **Step 2: Register handlers in index.ts**

In `packages/backend/src/index.ts`, add the import at the top with the other handler imports (after line 21):

```typescript
import { registerTypeScriptHandlers } from "./handlers/typescript";
```

Then add the registration call after `registerGitHandlers` (after line 274):

```typescript
        registerTypeScriptHandlers({
            router,
            taskStore: store,
        });
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/typescript.ts packages/backend/src/index.ts
git commit -m "feat: add WebSocket handlers for TypeScript tsconfig and import resolution"
```

---

### Task 4: Create Frontend Import Navigation Module

**Files:**
- Create: `packages/ui/src/lib/monaco-import-navigation.ts`

- [ ] **Step 1: Create the import navigation module**

Create `packages/ui/src/lib/monaco-import-navigation.ts`:

```typescript
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

/**
 * Sync Monaco's TypeScript compiler options with the nearest tsconfig for the given file.
 * Only calls the backend if the file's directory hasn't been seen before.
 */
async function syncCompilerOptions(filePath: string): Promise<void> {
    const dir = filePath.substring(0, filePath.lastIndexOf("/"));

    // Check if we've already resolved this directory
    if (dirTsconfigCache.has(dir)) {
        const cachedPath = dirTsconfigCache.get(dir)!;
        if (cachedPath === activeTsconfigPath) return;
        // Different tsconfig — need to re-fetch to get options
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

    // Map raw tsconfig compilerOptions to Monaco's TypeScript compiler options.
    // Monaco uses its own enum values, so we pass the raw JSON and let Monaco
    // interpret string values (e.g., "esnext" for target/module).
    const opts = result.compilerOptions;

    // Build Monaco-compatible compiler options, preserving existing defaults
    const monacoOpts: monaco.languages.typescript.CompilerOptions = {
        allowJs: true,
        allowNonTsExtensions: true,
        esModuleInterop: true,
        jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
        target: monaco.languages.typescript.ScriptTarget.ESNext,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    };

    // Apply tsconfig overrides where they exist
    if (opts.baseUrl !== undefined) monacoOpts.baseUrl = opts.baseUrl as string;
    if (opts.paths !== undefined) monacoOpts.paths = opts.paths as Record<string, string[]>;
    if (opts.rootDir !== undefined) monacoOpts.rootDir = opts.rootDir as string;
    if (opts.rootDirs !== undefined) monacoOpts.rootDirs = opts.rootDirs as string[];
    if (opts.strict !== undefined) monacoOpts.strict = opts.strict as boolean;

    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(monacoOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(monacoOpts);
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

let definitionProviderDisposable: monaco.IDisposable | null = null;

/**
 * Register the Monaco definition provider for Cmd+click import navigation.
 * Call this once on app startup. The `openFile` callback is called when
 * a definition is resolved to a file path.
 */
function registerDefinitionProvider(openFile: OpenFileCallback): void {
    if (definitionProviderDisposable) return;

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

    definitionProviderDisposable = monaco.languages.registerDefinitionProvider(
        "typescript",
        provider,
    );
    // Also register for javascript (separate language ID in Monaco)
    definitionProviderDisposable = monaco.languages.registerDefinitionProvider(
        "javascript",
        provider,
    );
}

export { syncCompilerOptions, registerDefinitionProvider };
```

- [ ] **Step 2: Verify UI compiles**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/monaco-import-navigation.ts
git commit -m "feat: add Monaco definition provider for import navigation"
```

---

### Task 5: Integrate Import Navigation into Editor

**Files:**
- Modify: `packages/ui/src/components/panes/EditorPaneImpl.tsx`

- [ ] **Step 1: Add import and integrate sync + registration**

In `packages/ui/src/components/panes/EditorPaneImpl.tsx`, add the import after the existing imports (after line 11):

```typescript
import { syncCompilerOptions, registerDefinitionProvider } from "@/lib/monaco-import-navigation";
import { openFileInApp } from "@/lib/open-file";
import { useSessionStore } from "@/stores/session-store";
```

- [ ] **Step 2: Register the definition provider at module level**

After the existing module-level Monaco configuration (after line 62, where `javascriptDefaults.setDiagnosticsOptions` is called), add:

```typescript
// Register Cmd+click import navigation.
// The provider is registered once globally; the openFile callback reads
// current workspace context at call time via store.getState().
registerDefinitionProvider((filePath: string) => {
    const state = useSessionStore.getState();
    const workspaceKey = state.activeWorkspace;
    if (!workspaceKey) return;
    void openFileInApp(filePath, workspaceKey);
});
```

- [ ] **Step 3: Add compiler options sync when file loads**

Inside the `EditorPaneImpl` component, in the main `useEffect` (the one that creates the editor), add a call to sync compiler options. After the editor is created and model is set (after line 116 `editorRef.current = editor;`), add:

```typescript
        // Sync TypeScript compiler options with nearest tsconfig
        const language = getLanguage(filePath);
        if (language === "typescript" || language === "javascript") {
            void syncCompilerOptions(filePath);
        }
```

- [ ] **Step 4: Remove the hardcoded compiler options that are now managed by sync**

The existing module-level compiler options (lines 43-51) should stay as defaults. The `syncCompilerOptions` function will override them when a tsconfig is found, and they serve as fallback when no tsconfig exists. No changes needed to the existing defaults.

- [ ] **Step 5: Verify UI compiles**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/panes/EditorPaneImpl.tsx
git commit -m "feat: integrate import navigation into Monaco editor"
```

---

### Task 6: Install Backend TypeScript Dependency and Verify End-to-End

**Files:**
- Verify: `packages/backend/package.json` (should already have `typescript` from Task 2)

- [ ] **Step 1: Install all dependencies**

```bash
cd /path/to/project/root && bun install
```

- [ ] **Step 2: Typecheck all packages**

```bash
cd packages/shared && bunx tsc --noEmit
cd packages/backend && bunx tsc --noEmit
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors in any package

- [ ] **Step 3: Lint check**

Run the project's lint command if available:

```bash
cd packages/ui && bun run lint
cd packages/backend && bun run lint
```

Expected: No new lint errors

- [ ] **Step 4: Manual verification plan**

To manually verify:
1. Start the backend and UI in dev mode
2. Open a TypeScript file that imports from another file (e.g., `import { MSG } from "@taskflow/shared"`)
3. Hold Cmd and hover over the import path — it should become an underlined link
4. Cmd+click the import path — the target file should open in a new editor tab
5. Test with relative imports (e.g., `./foo`)
6. Test with path aliases if the project has `tsconfig.json` paths configured
7. Test with a file from a project that doesn't have TypeScript installed — should use bundled fallback

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any remaining issues from integration testing"
```

---

### Task 7: Handle Definition Provider Disposal

**Files:**
- Modify: `packages/ui/src/lib/monaco-import-navigation.ts`

The current implementation registers two `DefinitionProvider`s but only stores the last disposable. Fix this to properly track both.

- [ ] **Step 1: Fix disposable tracking**

In `packages/ui/src/lib/monaco-import-navigation.ts`, replace the `definitionProviderDisposable` variable and the registration logic at the end of `registerDefinitionProvider`:

Replace:
```typescript
let definitionProviderDisposable: monaco.IDisposable | null = null;
```

With:
```typescript
const definitionProviderDisposables: monaco.IDisposable[] = [];
```

Replace the guard at the top of `registerDefinitionProvider`:
```typescript
    if (definitionProviderDisposable) return;
```

With:
```typescript
    if (definitionProviderDisposables.length > 0) return;
```

Replace the two registration lines at the end:
```typescript
    definitionProviderDisposable = monaco.languages.registerDefinitionProvider(
        "typescript",
        provider,
    );
    // Also register for javascript (separate language ID in Monaco)
    definitionProviderDisposable = monaco.languages.registerDefinitionProvider(
        "javascript",
        provider,
    );
```

With:
```typescript
    definitionProviderDisposables.push(
        monaco.languages.registerDefinitionProvider("typescript", provider),
        monaco.languages.registerDefinitionProvider("javascript", provider),
    );
```

- [ ] **Step 2: Verify UI compiles**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/monaco-import-navigation.ts
git commit -m "fix: properly track both definition provider disposables"
```
