import { resolve, dirname } from "path";
import { access } from "fs/promises";
import ts from "typescript";

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

interface LoadedTsconfig {
    tsconfigPath: string;
    compilerOptions: ts.CompilerOptions;
    raw: Record<string, unknown>;
}

/**
 * Find and parse the nearest tsconfig.json for a given file path, using
 * TypeScript's own `findConfigFile` and `readConfigFile`. Read on every call
 * (nothing is cached): the user edits `paths` or adds a tsconfig while the
 * backend runs, and a stale parse would send navigation to the old target.
 */
async function loadTsconfig(filePath: string): Promise<LoadedTsconfig | null> {
    const tsInstance = await getTsForProject(filePath);
    const tsconfigPath = tsInstance.findConfigFile(
        dirname(filePath),
        tsInstance.sys.fileExists,
        "tsconfig.json",
    );
    if (!tsconfigPath) return null;

    const configFile = tsInstance.readConfigFile(tsconfigPath, tsInstance.sys.readFile);
    if (configFile.error) return null;

    const configJson = configFile.config as
        | { compilerOptions?: Record<string, unknown> }
        | undefined;

    // Only the options are needed; an empty directory listing keeps TypeScript
    // from expanding `include` globs over the whole project on each request.
    const parsed = tsInstance.parseJsonConfigFileContent(
        configJson,
        { ...tsInstance.sys, readDirectory: () => [] },
        dirname(tsconfigPath),
    );

    return {
        tsconfigPath,
        compilerOptions: parsed.options,
        // A serializable subset of compiler options for Monaco
        raw: configJson?.compilerOptions ?? {},
    };
}

export async function resolveTsconfig(filePath: string): Promise<{
    tsconfigPath: string | null;
    compilerOptions: Record<string, unknown>;
}> {
    const loaded = await loadTsconfig(filePath);
    if (!loaded) return { tsconfigPath: null, compilerOptions: {} };
    return { tsconfigPath: loaded.tsconfigPath, compilerOptions: loaded.raw };
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
    const compilerOptions = (await loadTsconfig(sourceFilePath))?.compilerOptions ?? {};

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
