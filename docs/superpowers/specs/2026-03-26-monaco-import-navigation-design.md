# Monaco Import Navigation (Cmd+Click)

## Goal

Enable VSCode-style Cmd+click on imports in Monaco editor. Clicking an import opens the target file in a new editor tab. Supports relative imports, tsconfig path aliases, and `node_modules` resolution — powered by TypeScript's own module resolution.

## Scope

- **In scope:** TS/JS files (ts, tsx, js, jsx) only
- **Out of scope:** CSS/JSON imports, peek definition, find all references, semantic validation, diagnostics

## Architecture

Two main components: a backend TypeScript resolution service and a frontend definition provider.

### Backend: TypeScript Resolution Service

#### TypeScript Loading

- Check for `node_modules/typescript` in the project directory (walk up from the file being resolved)
- If not found, use a version bundled with the app
- Cache the loaded TypeScript instance per project root

#### WebSocket Handlers

**`tsconfig:resolve`**

- Input: `{ filePath: string }`
- Behavior: Uses `ts.findConfigFile()` to walk up from the file's directory. Parses with `ts.readConfigFile()` and `ts.parseJsonConfigFileHost()`. Handles `extends` chains via TypeScript's own parsing.
- Output: `{ tsconfigPath: string, compilerOptions: object }` or `{ tsconfigPath: null }` if none found
- Caching: Results cached per tsconfig file path. Invalidated if the tsconfig file changes.

**`import:resolve`**

- Input: `{ sourceFilePath: string, importSpecifier: string }`
- Behavior: Uses `ts.resolveModuleName()` with the compiler options from the nearest tsconfig (resolved via `tsconfig:resolve` internally). Returns the resolved absolute file path.
- Output: `{ resolvedPath: string | null }`

### Frontend: Definition Provider

#### Compiler Options Sync

When a TS/JS file becomes the active editor tab:

1. Call backend `tsconfig:resolve` with the file path
2. Compare the returned tsconfig path against the currently applied one
3. If different, update `monaco.languages.typescript.typescriptDefaults.setCompilerOptions()` and `monaco.languages.typescript.javascriptDefaults.setCompilerOptions()` with the new options
4. Cache the mapping of file directory to tsconfig path so we only call the backend once per directory

#### Definition Provider Registration

Register a `DefinitionProvider` for both `typescript` and `javascript` languages:

1. On Cmd+click, call Monaco's TypeScript worker via `getDefinitionAtPosition()`
2. If it returns a result with a file URI:
   - If the file is already open as a Monaco model, open it in a new tab via `openFileInApp()`
   - If not, open it anyway — the editor tab creation flow will load the file
3. If the TypeScript worker fails to resolve (file not in virtual FS):
   - Extract the import specifier from the token at the cursor position
   - Call backend `import:resolve` with the source file path and import specifier
   - If resolved, open the target file via `openFileInApp()`

### What Stays Unchanged

- Existing autocomplete suggestions continue to work
- Hover type info for in-file types continues to work
- Semantic validation remains disabled (`noSemanticValidation: true`)
- Suggestion diagnostics remain disabled (`noSuggestionDiagnostics: true`)
- Non-TS/JS files are unaffected
- Editor tab management, file opening flow, and dirty state tracking unchanged

### Multi-tsconfig Handling

Monaco's TypeScript language service maintains a single global set of compiler options. Since we don't show diagnostics, this is acceptable — we only need correct resolution at the moment of Cmd+click.

When the user switches between files that belong to different tsconfig zones, we update the compiler options to match the active file's config. The "inactive" models temporarily lose their config context, which has no visible effect since diagnostics are disabled.

## Bundled TypeScript

TypeScript needs to be bundled with the app as a fallback for projects that don't have it installed. This is a runtime dependency of the backend, loaded dynamically when needed. The bundled version serves as a fallback only — the project's own TypeScript is preferred when available.
