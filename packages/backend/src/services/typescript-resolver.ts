import { resolve, dirname } from "path";
import { access } from "fs/promises";
import ts from "typescript";

/** Cache of parsed tsconfig results keyed by tsconfig file path */
const tsconfigCache = new Map<
    string,
    {
        compilerOptions: ts.CompilerOptions;
        raw: Record<string, unknown>;
    }
>();

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
        const projectTs = (await import(resolve(projectTsPath, "lib", "typescript.js"))) as {
            default?: typeof ts;
        };
        return projectTs.default ?? ts;
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
        const cached = tsInstanceCache.get(dir);
        if (cached) {
            return cached;
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
    const cachedDir = dirToTsconfigPath.get(dir);
    if (cachedDir !== undefined) {
        if (cachedDir === null) {
            return { tsconfigPath: null, compilerOptions: {} };
        }
        const cached = tsconfigCache.get(cachedDir);
        if (cached) {
            return { tsconfigPath: cachedDir, compilerOptions: cached.raw };
        }
    }

    const tsInstance = await getTsForProject(filePath);

    const tsconfigPath = tsInstance.findConfigFile(dir, tsInstance.sys.fileExists, "tsconfig.json");

    if (!tsconfigPath) {
        dirToTsconfigPath.set(dir, null);
        return { tsconfigPath: null, compilerOptions: {} };
    }

    // Check tsconfig cache
    const cachedConfig = tsconfigCache.get(tsconfigPath);
    if (cachedConfig) {
        dirToTsconfigPath.set(dir, tsconfigPath);
        return { tsconfigPath, compilerOptions: cachedConfig.raw };
    }

    // Parse the tsconfig
    const configFile = tsInstance.readConfigFile(tsconfigPath, tsInstance.sys.readFile);
    if (configFile.error) {
        dirToTsconfigPath.set(dir, null);
        return { tsconfigPath: null, compilerOptions: {} };
    }

    const configJson = configFile.config as
        | { compilerOptions?: Record<string, unknown> }
        | undefined;

    const parsed = tsInstance.parseJsonConfigFileContent(
        configJson,
        tsInstance.sys,
        dirname(tsconfigPath),
    );

    // Extract a serializable subset of compiler options for Monaco
    const raw: Record<string, unknown> = configJson?.compilerOptions ?? {};

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
        ? (tsconfigCache.get(tsconfigPath)?.compilerOptions ?? {})
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
