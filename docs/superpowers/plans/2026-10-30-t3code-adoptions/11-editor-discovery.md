# Section 11: Shared editor command resolver

Read `handoff.md`, `design.md` §8 and `reviews/research-5-git-desktop.md`. Anchors were verified on 2026-10-30. Use the candidate rules in t3code `packages/shared/src/editor.ts`; keep Taskflow's editor catalog and launch behavior.

**Files:**

- Create: `packages/backend/src/services/editor-resolver.ts` and `packages/backend/tests/services/editor-resolver.test.ts`.
- Modify: `packages/backend/src/services/editor-detector.ts:4`, `:21`, `:33`. Keep the existing ids, names, internal/external distinction, `lineFlag` and `extraArgs`; resolve each editor through the new module.
- Modify: `packages/backend/src/handlers/file.ts:23`, `:116`. Use the same resolver for external opening, with injected resolution/spawn dependencies in tests.
- Create: `packages/backend/tests/services/editor-detector.test.ts`; extend `packages/backend/tests/handlers/file.test.ts:22` using its real TaskStore/project fixture and TestRouter.
- Reuse without modification: `packages/backend/src/services/shell-path.ts:88`'s `buildShellPath`, `packages/backend/src/services/platform.ts:31`'s `getHomeDir`, and shared `EditorInfo` at `packages/shared/src/types/system.ts:1`.
- Directly affected integrations to verify: `packages/backend/src/index.ts:134` supplies detected editors; `packages/backend/src/services/session-lifecycle.ts:418` uses `EditorInfo.command`, `extraArgs` and `lineFlag`; `packages/ui/src/lib/open-file.ts:12` caches editor availability per backend. No protocol or CLI change is required.

**Interfaces:**

Consumes `EditorInfo` and the backend's shell PATH. Produces a resolved executable path that both detection and opening use. Do not duplicate the editor catalog in the resolver.

```ts
// editor-resolver.ts. Export this interface because detector and handler inject it.
interface EditorResolverDeps {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    homeDir: string;
    path: string;
    which(command: string, path: string): string | null;
    executable(path: string): Promise<boolean>;
    readDirectory(path: string): Promise<string[]>;
    version(command: string): Promise<string | null>;
}
function resolveEditorCommand(
    editor: Pick<EditorInfo, "id" | "name" | "command">,
    deps?: EditorResolverDeps,
): Promise<string | null>;
// Defaults wrap Bun.which(command, { PATH }), fs access/stat/readdir and a bounded
// argv-only --version probe. OS/environment are read at invocation, not import time.

// editor-detector.ts. Existing zero-argument call remains valid.
function detectEditors(deps?: {
    resolve?: typeof resolveEditorCommand;
}): Promise<EditorInfo[]>;
// Return a copy with command = resolved executable, preserving all other metadata.
// getEditorById(editors: EditorInfo[], id: string): EditorInfo | undefined is unchanged.
// Export only because the file handler imports this catalog lookup.
function getKnownEditor(commandOrId: string): EditorInfo | undefined;

// FileHandlerDeps additions, with real defaults inside registerFileHandlers.
resolveEditor?: typeof resolveEditorCommand;
spawnEditor?: (command: string, args: string[]) => void;
```

Implementation detail: resolve an executable path rather than introducing a second editor type. Existing `EditorInfo.command` already carries the command that sessions launch.

## Behavior

### Candidate rules

- Add attribution above the adapted resolver rules: `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): packages/shared/src/editor.ts`. Why: one resolver prevents detection and launch from disagreeing about GUI-only installations.
- Use Taskflow's existing seven external editors and seven internal editors. Do not add t3code's extra products as part of this section. Internal editors remain PATH-only and keep their current arguments. Resolve sequentially in catalog order; there is no long-lived resolver cache that could retain an uninstalled executable.
- On non-Zed editors, PATH wins, using `buildShellPath()`. `which` returns an absolute path. Next try platform candidates in the order below and select the first runnable file. A missing/unreadable search directory contributes no candidates. An inaccessible candidate is skipped. Do not run a shell or modify PATH globally.
- Use these bundle names and executable suffixes for existing external ids:

  | id         | macOS bundle names                                            | bundle executable                                          |
  | ---------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
  | `vscode`   | `Visual Studio Code`                                          | `Contents/Resources/app/bin/code`                          |
  | `cursor`   | `Cursor`                                                      | `Contents/Resources/app/bin/cursor`, then `.../bin/code`   |
  | `windsurf` | `Windsurf`                                                    | `Contents/Resources/app/bin/windsurf`, then `.../bin/code` |
  | `zed`      | `Zed`                                                         | `Contents/MacOS/cli`                                       |
  | `sublime`  | `Sublime Text`                                                | `Contents/SharedSupport/bin/subl`                          |
  | `webstorm` | `WebStorm`                                                    | `Contents/MacOS/webstorm`                                  |
  | `idea`     | `IntelliJ IDEA`, `IntelliJ IDEA CE`, `IntelliJ IDEA Ultimate` | `Contents/MacOS/idea`                                      |

- macOS roots are `<home>/Applications`, then `/Applications`. For each root, check exact bundle names first. For JetBrains also accept `<name> <version>.app` where version matches `^\d[\d.]*$`, as t3code does. Sort additional versions descending with numeric comparison to make selection deterministic. Do not match `Visual Studio Code - Insiders.app` as stable Code. After bundles, JetBrains checks `<home>/Library/Application Support/JetBrains/Toolbox/scripts/<command>`.
- Linux fallback directories are `<home>/.local/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`, in that order. JetBrains also checks `<XDG_DATA_HOME>/JetBrains/Toolbox/scripts`, falling back to `<home>/.local/share/JetBrains/Toolbox/scripts`. Use `command` names `webstorm` and `idea`, not display names. Do not recursively scan the disk.
- Windows candidate roots follow t3code: `<LOCALAPPDATA>/Programs`, `ProgramFiles`, `ProgramFiles(x86)`, `ProgramW6432`, de-duplicated. Code's install directory is `Microsoft VS Code`; Cursor/Windsurf use display names. Check only native executables (see "Planner decisions"): `Code.exe`, `Cursor.exe`, `Windsurf.exe` in their install directories. Zed checks `Zed/bin/zed.exe` and `Zed/zed.exe`. JetBrains checks matching product directories under each root and `<root>/JetBrains`, with `bin/<command>64.exe` before `bin/<command>.exe`. No `.cmd` candidate is added: not `resources/app/bin/*.cmd`, not `bin/*.cmd`, not Toolbox `scripts/*.cmd`. Versioned JetBrains product directory names must be exact or start with `<product name> `. Use `path.win32` in injected Windows tests so tests do not accidentally construct POSIX paths.
- Adapt the Sublime bundle path above explicitly; t3code's generic Electron bundle fallback does not describe Sublime. The existing `subl` PATH behavior remains first.

### Zed identity

- macOS prefers the known Zed bundle before PATH `zed`. Linux prefers `zeditor` on PATH and in fallback directories, then checks `zed`. Why: OpenZFS also installs a `zed` executable.
- A candidate named `zed` outside the known macOS bundle must pass an argv-only `<candidate> --version` identity probe. Accept output whose first trimmed line matches `^Zed\s+\d` case-insensitively. Refuse an error, timeout, empty output, or OpenZFS output. The probe has a 1,000 ms deadline and a combined 8 KiB output limit; kill and reap on a limit. `zeditor` and the known bundle do not need a probe. `zed.exe` in the expected Windows Zed installation directory is a known candidate; arbitrary PATH `zed.exe` must pass the same identity check.
- Never report a bare `zed` as available merely because `which` finds it. No fallback may bypass that check. Do not execute it with a workspace file to discover its identity.

### Detection and launching

- Detection returns copied `EditorInfo` records whose command is the resolved path. Do not mutate catalog objects between calls. Preserve internal editor metadata exactly so session-lifecycle's line navigation still works.
- External opening keeps `assertWorkspacePath` before resolver/spawn. Preserve selection `process.env.EDITOR || "code"`; do not add settings, new UI choices or tokenization of editor strings. For a known id or command, look up the existing catalog metadata and resolve it. Move/export a single catalog lookup from `editor-detector.ts` only if the handler actually imports it; do not copy the external array into the handler. Unknown values, including absolute executable paths, resolve through PATH/executable checks only. Preserve the existing one-executable meaning of `EDITOR`; `code --wait` is not parsed as shell code.
- If resolution fails, throw exactly `Editor "<editor>" not found`. The old suffix `on PATH` is now inaccurate. Spawn `[resolvedCommand, resolvedPath]`, with the existing ignored stdio. One file path remains one argument even when it contains spaces. Tests inject `spawnEditor`, so no editor opens during a suite.
- Windows adds native executables only (see "Planner decisions"). Never declare an editor available unless the real launcher can run that candidate.
- Backend detection/opening remains on the machine that owns the file. Do not change Electron's separate local `open-in-editor` mapping in `electron/src/ipc-handlers.ts:180`; §8 explicitly selects backend detection and `FILE_OPEN_EXTERNAL`, not a cross-machine desktop-launch redesign.

## Steps

- [ ] **Step 1:** Write resolver tests with injected platform, env, directory entries, executable set and version output: `PATH wins for an ordinary editor`, `a macOS app bundle works without a PATH shim`, `home Applications precedes system Applications`, `versioned JetBrains bundles match only numeric versions`, `stable Code does not select Insiders`, `macOS and Linux Toolbox scripts are found`, `Windows JetBrains native executables are found`, `Windows never adds a .cmd candidate (Toolbox scripts and resources/app/bin)`, `Windows PATH lookup behaves as today`, `Linux zeditor is preferred to zed`, `Zed bundle is preferred to an OpenZFS PATH command`, `OpenZFS zed is never returned`, `an unverified zed timeout is unavailable`, `a verified Zed PATH executable is returned`, `Sublime uses its SharedSupport executable`, `unreadable directories do not abort detection`, `unknown editor commands use PATH without bundle guessing`. Use maps/arrays as fake filesystem deps; no `mock.module`.
- [ ] **Step 2:** Run `bun test packages/backend/tests/services/editor-resolver.test.ts`. Expected: FAIL. Implement the resolver and bounded identity probe. Run the same command. Expected: PASS.
- [ ] **Step 3:** Write detector tests with an injected resolver: `detected editors contain resolved commands and unchanged metadata`, `internal line flags and extra args survive resolution`, `a second detection cannot mutate the catalog`, `an unresolved editor is omitted`. Extend file handler tests: `external open launches the shared resolved command`, `bundle-only Code is launchable`, `unknown editor reports the exact not-found message`, `a rejected workspace path never reaches resolver or spawn`, `a file path containing spaces is one spawn argument`. Inject dependencies and restore EDITOR in teardown.
- [ ] **Step 4:** Run `bun test packages/backend/tests/services/editor-detector.test.ts packages/backend/tests/handlers/file.test.ts`. Expected: FAIL. Implement shared catalog lookup and both call sites, preserving default zero-argument detection. Run Steps 2 and 4 commands. Expected: PASS.
- [ ] **Step 5:** Run `bun run typecheck`, `bun test packages/backend`, `bun test packages/shared` and `bun test packages/ui/src/lib/open-file-plan.test.ts`. Expected: PASS. Lint changed TS files and check formatting only on those files. Verify the existing internal editor launch still gets `extraArgs`, separate file paths and line flags through `session-lifecycle.ts:421`.
- [ ] **Step 6:** Record manual backend acceptance on available OSes: a macOS bundle without a shim, versioned JetBrains/Toolbox, Linux `zeditor`, OpenZFS-only `zed` rejection, and Windows native executables (no new `.cmd` candidates). Keep actual platform runs separate from injected-platform tests. Check running apps before starting a test instance; never reuse another agent's backend or editor session.
- [ ] **Step 7:** Run `git diff --check`, stage only this section's files, and commit `fix(editors): share platform-aware discovery and launch resolution`. No push or trailers.

## Planner decisions (2026-10-30)

- **Windows: no new `.cmd` candidates.** Only native executables are added as Windows candidates: `Code.exe`, `Cursor.exe`, `Windsurf.exe` in their install directories, Zed's `zed.exe`, and JetBrains `bin/<command>64.exe` / `bin/<command>.exe`. Toolbox `.cmd` scripts and `resources/app/bin/*.cmd` are left out. Whatever `PATH` lookup finds today keeps working exactly as today. No `shell: true`.
