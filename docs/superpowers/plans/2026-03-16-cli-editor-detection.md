# CLI Editor Detection & Internal Editor Setting — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to choose a CLI editor (nvim, vim, etc.) as their internal editor, opening files in terminal tabs instead of Monaco.

**Architecture:** Extend `EditorInfo` with type/lineFlag/extraArgs fields. Split editor detection into internal (CLI) and external (GUI) categories. Add `"editor"` session type that spawns a CLI editor in a PTY. Route file-open logic through the `internalEditor` setting to decide between Monaco tab and terminal-editor tab.

**Tech Stack:** TypeScript, Bun PTY, Zustand, React, WebSocket messages

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types/system.ts` | Add `type`, `lineFlag`, `extraArgs` to `EditorInfo` |
| Modify | `packages/shared/src/types/settings.ts` | Add `internalEditor` + `externalEditor` to `EditorSettings`, remove `externalEditor` from `GeneralSettings` |
| Modify | `packages/shared/src/types/task.ts:3-8` | Add `"editor"` to `SessionRef.type` union |
| Modify | `packages/shared/src/types/ws.ts:114-124` | Add `"editor"` to `SessionCreatePayload.type`, add `editorId`, `filePath`, `line` fields |
| Modify | `packages/backend/src/services/editor-detector.ts` | Rewrite with internal/external editor lists, `type` field, line flags |
| Modify | `packages/backend/src/services/session-lifecycle.ts:13-28` | Add `"editor"` to type union, add `editorId`/`filePath`/`line` to opts, add editor command-building logic |
| Modify | `packages/backend/src/handlers/session.ts:26-39` | Destructure and forward new editor fields |
| Modify | `packages/backend/src/services/settings-store.ts:12-51` | Add `internalEditor`/`externalEditor` to editor defaults, remove from general, add migration |
| Modify | `packages/ui/src/stores/session-store.ts:19-40` | Add `"editor"` to Tab.type, extend `createSession` signature with editor fields |
| Modify | `packages/ui/src/components/panes/TerminalPane.tsx:129-145` | Route `openFileInApp` through internalEditor setting |
| Modify | `packages/ui/src/components/workspace/TabContent.tsx:61-68` | Render TerminalPane for editor tabs with sessionId |
| Modify | `packages/ui/src/components/settings/SettingsModal.tsx:48-58,474-498` | Add internal editor dropdown, make external editor dynamic |
| Modify | `electron/src/main.ts:614-660` | Remove emacs from external editor commands |

---

### Task 1: Extend shared types

**Files:**
- Modify: `packages/shared/src/types/system.ts:1-9`
- Modify: `packages/shared/src/types/settings.ts:3-9,26-30`
- Modify: `packages/shared/src/types/task.ts:3-8`
- Modify: `packages/shared/src/types/ws.ts:114-124`

- [ ] **Step 1: Update `EditorInfo` in `system.ts`**

```typescript
export interface EditorInfo {
    id: string;
    name: string;
    command: string;
    type: "internal" | "external";
    /** Format string for line navigation. Uses {line} and {file} placeholders.
     *  e.g. "+{line}" (vim-style) or "{file}:{line}" (helix-style).
     *  When lineFlag contains {file}, the file path is embedded in the flag
     *  and must NOT be passed as a separate argument. */
    lineFlag?: string;
    /** Extra args always passed, e.g. ["-nw"] for emacs */
    extraArgs?: string[];
}

export interface SystemInfo {
    editors: EditorInfo[];
}
```

- [ ] **Step 2: Update `settings.ts` — move `externalEditor` from `GeneralSettings` to `EditorSettings`, add `internalEditor`**

```typescript
export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    defaultAgent: AgentType;
    defaultRuntime: string;
}

export interface EditorSettings {
    fontFamily: string;
    fontSize: number;
    wordWrap: boolean;
    internalEditor: string;
    externalEditor: string;
}
```

- [ ] **Step 3: Add `"editor"` to `SessionRef.type` in `task.ts`**

Change line 5 from:
```typescript
    type: "claude" | "codex" | "shell";
```
to:
```typescript
    type: "claude" | "codex" | "shell" | "editor";
```

- [ ] **Step 4: Add `"editor"` to `SessionCreatePayload` in `ws.ts`, add editor fields**

```typescript
export interface SessionCreatePayload {
    taskId?: string;
    projectId?: string;
    type: "claude" | "codex" | "shell" | "editor";
    label?: string;
    prompt?: string;
    shell?: string;
    cols?: number;
    rows?: number;
    agentOptions?: AgentLaunchOptions;
    editorId?: string;
    filePath?: string;
    line?: number;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/system.ts packages/shared/src/types/settings.ts packages/shared/src/types/task.ts packages/shared/src/types/ws.ts
git commit -m "feat: extend shared types for CLI editor support"
```

---

### Task 2: Rewrite editor detector

**Files:**
- Modify: `packages/backend/src/services/editor-detector.ts:1-21`

- [ ] **Step 1: Rewrite `editor-detector.ts` with internal/external editor lists**

```typescript
import type { EditorInfo } from "@taskflow/shared";
import { buildShellPath } from "./shell-path";

const INTERNAL_EDITORS: EditorInfo[] = [
    { id: "nvim", name: "Neovim", command: "nvim", type: "internal", lineFlag: "+{line}" },
    { id: "vim", name: "Vim", command: "vim", type: "internal", lineFlag: "+{line}" },
    { id: "nano", name: "Nano", command: "nano", type: "internal", lineFlag: "+{line}" },
    { id: "helix", name: "Helix", command: "hx", type: "internal", lineFlag: "{file}:{line}" },
    { id: "micro", name: "Micro", command: "micro", type: "internal", lineFlag: "+{line}" },
    {
        id: "emacs",
        name: "Emacs",
        command: "emacs",
        type: "internal",
        lineFlag: "+{line}",
        extraArgs: ["-nw"],
    },
];

const EXTERNAL_EDITORS: EditorInfo[] = [
    { id: "vscode", name: "VS Code", command: "code", type: "external" },
    { id: "cursor", name: "Cursor", command: "cursor", type: "external" },
    { id: "zed", name: "Zed", command: "zed", type: "external" },
    { id: "sublime", name: "Sublime Text", command: "subl", type: "external" },
    { id: "windsurf", name: "Windsurf", command: "windsurf", type: "external" },
    { id: "webstorm", name: "WebStorm", command: "webstorm", type: "external" },
    { id: "idea", name: "IntelliJ IDEA", command: "idea", type: "external" },
];

const ALL_KNOWN_EDITORS = [...INTERNAL_EDITORS, ...EXTERNAL_EDITORS];

export async function detectEditors(): Promise<EditorInfo[]> {
    const available: EditorInfo[] = [];
    const PATH = buildShellPath();
    for (const editor of ALL_KNOWN_EDITORS) {
        const path = Bun.which(editor.command, { PATH });
        if (path) available.push(editor);
    }
    return available;
}

export function getEditorById(editors: EditorInfo[], id: string): EditorInfo | undefined {
    return editors.find((e) => e.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/editor-detector.ts
git commit -m "feat: split editor detection into internal (CLI) and external (GUI) categories"
```

---

### Task 3: Backend settings migration

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts:12-51,71-91`

- [ ] **Step 1: Update DEFAULTS — move `externalEditor` from `general` to `editor`, add `internalEditor`**

In the `DEFAULTS` object:
- Remove `externalEditor: "system"` from `general`
- Add `internalEditor: "monaco"` and `externalEditor: "system"` to `editor`

```typescript
const DEFAULTS: AppSettings = {
    general: {
        fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
        fontSize: 13,
        defaultAgent: "claude",
        defaultRuntime: "bun",
    },
    // ...
    editor: {
        fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
        fontSize: DEFAULT_EDITOR_FONT_SIZE,
        wordWrap: DEFAULT_EDITOR_WORD_WRAP,
        internalEditor: "monaco",
        externalEditor: "system",
    },
    // ... rest unchanged
};
```

- [ ] **Step 2: Add migration in `get()` method — if `general.externalEditor` exists in persisted data, copy to `editor.externalEditor` and delete from general**

In the `get()` method, add migration logic before the merge. Use a `needsMigration` flag to track whether to persist:

```typescript
async get(): Promise<AppSettings> {
    try {
        const raw = await readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<AppSettings> & {
            general?: Partial<GeneralSettings> & { externalEditor?: string };
        };
        const defaults = createDefaultSettings();

        // Migration: move externalEditor from general to editor
        let needsMigration = false;
        if (parsed.general && "externalEditor" in parsed.general) {
            if (!parsed.editor) parsed.editor = {};
            if (!parsed.editor.externalEditor) {
                parsed.editor.externalEditor = parsed.general.externalEditor;
            }
            delete parsed.general.externalEditor;
            needsMigration = true;
        }

        const result = {
            general: { ...defaults.general, ...parsed.general },
            terminal: { ...defaults.terminal, ...parsed.terminal },
            editor: { ...defaults.editor, ...parsed.editor },
            layout: {
                window: { ...defaults.layout.window, ...parsed.layout?.window },
                panels: { ...defaults.layout.panels, ...parsed.layout?.panels },
            },
            claude: { ...defaults.claude, ...parsed.claude },
            codex: { ...defaults.codex, ...parsed.codex },
            appearance: { ...defaults.appearance, ...parsed.appearance },
        };

        // Persist migration so it only runs once
        if (needsMigration) {
            await writeFile(this.filePath, JSON.stringify(result, null, 2));
        }

        return result;
    } catch {
        return createDefaultSettings();
    }
}
```

- [ ] **Step 3: Update `createDefaultSettings()` to match new DEFAULTS structure**

The spread copies already handle this since they spread from DEFAULTS. No additional change needed beyond the DEFAULTS update.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/settings-store.ts
git commit -m "feat: migrate externalEditor to editor settings, add internalEditor default"
```

---

### Task 4: Backend session lifecycle — editor session support

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts:13-28,98-218`
- Modify: `packages/backend/src/handlers/session.ts:26-39`

- [ ] **Step 1: Update `CreateSessionOpts` type to include editor fields and `"editor"` type**

```typescript
interface CreateSessionOpts {
    owner: SessionOwner;
    type: "claude" | "codex" | "shell" | "editor";
    label?: string;
    prompt?: string;
    systemPrompt?: string;
    shell?: string;
    editorId?: string;
    filePath?: string;
    line?: number;
    agentOptions?: import("@taskflow/shared").AgentLaunchOptions;
    flow?: {
        flowId: string;
        actionEntryId: string;
    };
    cols?: number;
    rows?: number;
    onSessionExited?: (sessionId: string, exitCode: number) => void;
}
```

- [ ] **Step 2: Update `getDefaultSessionLabel` to handle `"editor"` type**

```typescript
function getDefaultSessionLabel(type: CreateSessionOpts["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "editor") return "Editor";
    return `${type} session`;
}
```

- [ ] **Step 3: Add editor command-building logic in `createSession`**

In the `createSession` function, update the command-building block (lines 130-140). Add a new branch for `type === "editor"`:

```typescript
let command: string;
const args: string[] = [];
if (type === "editor") {
    const { editorId, filePath: editorFilePath, line } = opts;
    if (!editorId || !editorFilePath) {
        throw new Error("editorId and filePath are required for editor sessions");
    }
    // Look up editor from detected editors (passed via import)
    const editor = getEditorById(detectedEditors, editorId);
    if (!editor) throw new Error(`Editor not found: ${editorId}`);

    command = editor.command;
    if (editor.extraArgs) args.push(...editor.extraArgs);

    if (line && editor.lineFlag) {
        const resolvedFlag = editor.lineFlag
            .replace("{line}", String(line))
            .replace("{file}", editorFilePath);

        if (editor.lineFlag.includes("{file}")) {
            // File path is embedded in the flag (e.g., helix: "file:line")
            args.push(resolvedFlag);
        } else {
            args.push(resolvedFlag, editorFilePath);
        }
    } else {
        args.push(editorFilePath);
    }
} else if (type === "shell") {
    if (!shell) throw new Error("shell path is required for shell sessions");
    command = shell;
} else {
    const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
    const spec = buildAgentLaunchSpec(type, prompt, skillPath, agentOptions, systemPrompt);
    command = spec.command;
    args.push(...spec.args);
}
```

The `detectedEditors` need to be available inside `createSession`. Pass them through `SessionLifecycleDeps`:

```typescript
interface SessionLifecycleDeps {
    ptyManager: PtyManager;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    getPort: () => number;
    detectedEditors: import("@taskflow/shared").EditorInfo[];
}
```

Import `getEditorById` from `./editor-detector`.

**Important:** Also update the destructuring at the top of `createSessionLifecycle` (line 44) to include `detectedEditors`:
```typescript
const { ptyManager, taskStore, broadcast, getPort, detectedEditors } = deps;
```

- [ ] **Step 4: Update `SESSION_STATUS` broadcast — skip for editor sessions too (like shell)**

Change line 211 from:
```typescript
if (type !== "shell") {
```
to:
```typescript
if (type !== "shell" && type !== "editor") {
```

- [ ] **Step 5: Update session handler to destructure and forward new fields**

In `packages/backend/src/handlers/session.ts`, update the `SESSION_CREATE` handler (lines 26-39):

```typescript
router.register(MSG.SESSION_CREATE, async (payload) => {
    const {
        taskId,
        projectId,
        type,
        label,
        prompt,
        shell,
        cols,
        rows,
        agentOptions,
        editorId,
        filePath,
        line,
    } = payload as SessionCreatePayload;
    const sessionId = await sessionLifecycle.createSession({
        owner: { taskId, projectId },
        type,
        label,
        prompt,
        shell,
        agentOptions,
        cols,
        rows,
        editorId,
        filePath,
        line,
    });
    return { sessionId };
});
```

- [ ] **Step 6: Update backend `index.ts` to pass `detectedEditors` to `createSessionLifecycle`**

Find where `createSessionLifecycle` is called in `packages/backend/src/index.ts` and add the `detectedEditors` array to the deps. The editors are already detected at startup (the `detectEditors()` result is stored and returned via `MSG.SYSTEM_INFO`). Pass the same array to `createSessionLifecycle`:

```typescript
const detectedEditors = await detectEditors();
// ... existing code that uses detectedEditors for SYSTEM_INFO ...
const sessionLifecycle = createSessionLifecycle({
    ptyManager,
    taskStore,
    broadcast,
    getPort: () => port,
    detectedEditors,
});
```

**This must be committed atomically with the lifecycle changes** — the new `SessionLifecycleDeps` interface requires `detectedEditors`, so `index.ts` must be updated in the same commit.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts packages/backend/src/handlers/session.ts packages/backend/src/index.ts
git commit -m "feat: add editor session type to backend lifecycle"
```

---

### Task 5: Frontend session store — editor session support

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts:19-40,120-148`

- [ ] **Step 1: Add `"editor"` to `Tab.type` union (already present at line 21) — verify it includes `"editor"`**

The Tab type at line 21 already includes `"editor"`. No change needed here.

- [ ] **Step 2: Extend `createSession` method signature to accept editor params**

Update the `createSession` method signature in the `SessionStore` interface (lines 33-40):

```typescript
createSession(
    owner: { taskId?: string; projectId?: string },
    type: "claude" | "codex" | "shell" | "editor",
    label?: string,
    prompt?: string,
    shell?: string,
    agentOptions?: AgentLaunchOptions,
    editorOpts?: { editorId: string; filePath: string; line?: number },
): Promise<string>;
```

- [ ] **Step 3: Update `createSession` implementation to forward editor params**

Update the implementation (lines 120-148):

```typescript
async createSession(owner, type, label, prompt, shell, agentOptions, editorOpts) {
    const ownerId = owner.taskId ?? owner.projectId;
    if (!ownerId) throw new Error("Either taskId or projectId is required");
    const lastTerminalSize = get().lastTerminalSize;
    const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, {
        ...owner,
        type,
        label,
        prompt,
        shell,
        cols: lastTerminalSize?.cols,
        rows: lastTerminalSize?.rows,
        agentOptions,
        ...(editorOpts && {
            editorId: editorOpts.editorId,
            filePath: editorOpts.filePath,
            line: editorOpts.line,
        }),
    });
    const tab: Tab = {
        id: sessionId,
        type,
        label: normalizeSessionLabel(type, label),
        sessionId,
        // Note: filePath on editor tabs with sessionId is for display only.
        // It does NOT survive syncWithTasks (SessionRef has no filePath field).
        // This is fine — CLI editor tabs only need sessionId to render TerminalPane.
        ...(editorOpts && { filePath: editorOpts.filePath }),
    };
    const workspaceKey = owner.taskId
        ? getTaskWorkspaceKey(owner.taskId)
        : getProjectWorkspaceKey(ownerId);
    get().addTab(workspaceKey, tab);
    await Promise.all([
        owner.taskId ? useTaskStore.getState().fetchTasks() : Promise.resolve(),
        owner.projectId ? useProjectStore.getState().fetchProjects() : Promise.resolve(),
    ]);
    return sessionId;
},
```

- [ ] **Step 4: Update `getDefaultSessionLabel` and `normalizeSessionLabel` to handle `"editor"` type**

```typescript
function getDefaultSessionLabel(type: Tab["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "editor") return "Editor";
    return `${type} session`;
}
```

Also update `normalizeSessionLabel` — its default-label check uses `` `${type} session` `` which won't match `"Editor"` for the editor type. Add an explicit check:

```typescript
function normalizeSessionLabel(type: SessionRef["type"], label?: string): string {
    if (!label || label === `${type} session` || (type === "editor" && label === "Editor")) {
        return getDefaultSessionLabel(type);
    }
    return label;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: extend frontend session store with editor session support"
```

---

### Task 6: Frontend file-open routing — `openFileInApp` and `TabContent`

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:129-145,155-160`
- Modify: `packages/ui/src/components/workspace/TabContent.tsx:16-18,41-68`

- [ ] **Step 1: Update `openFileInApp` in `TerminalPane.tsx` to route through `internalEditor` setting**

Replace the `openFileInApp` function (lines 129-145) with:

```typescript
function openFileInApp(
    filePath: string,
    workspaceKey: string | null,
    owner?: { taskId?: string; projectId?: string },
    line?: number,
) {
    if (!workspaceKey) return;
    const store = useSessionStore.getState();
    const settings = useSettingsStore.getState().settings;
    const internalEditor = settings?.editor.internalEditor ?? "monaco";

    if (internalEditor === "monaco") {
        // Existing Monaco behavior
        const existingTabs = store.tabsByWorkspace[workspaceKey] ?? [];
        const existing = existingTabs.find(
            (t) => t.type === "editor" && t.filePath === filePath && !t.sessionId,
        );
        if (existing) {
            store.setActiveTab(workspaceKey, existing.id);
            return;
        }
        const label = filePath.split("/").pop() ?? filePath;
        store.addTab(workspaceKey, {
            id: crypto.randomUUID(),
            type: "editor",
            label,
            filePath,
        });
    } else if (owner) {
        // CLI editor: spawn terminal session
        const basename = filePath.split("/").pop() ?? filePath;
        const label = `${internalEditor}: ${basename}`;
        void store.createSession(
            owner,
            "editor",
            label,
            undefined,
            undefined,
            undefined,
            { editorId: internalEditor, filePath, line },
        );
    }
}
```

- [ ] **Step 2: Update `handlePathActivation` to pass `owner` and `line` to `openFileInApp`**

The `handlePathActivation` function (line 296) needs to receive and pass `taskId`/`projectId`. Update the call site at line 332:

```typescript
openFileInApp(resolved, workspaceKey, { taskId, projectId }, line);
```

Update `handlePathActivation` signature to accept `taskId` and `projectId`:

```typescript
async function handlePathActivation(
    text: string,
    workingDir: string | null,
    workspaceKey: string | null,
    event: MouseEvent,
    taskId?: string,
    projectId?: string,
): Promise<void> {
```

And pass them from the link provider's `activate` callback:

In `createFilePathLinkProvider` (line 284), update the activate call:
```typescript
activate(event: MouseEvent, text: string) {
    void handlePathActivation(text, workingDir, workspaceKey, event, taskId, projectId);
},
```

- [ ] **Step 3: Update `openExternalFile` to read from `editor.externalEditor` instead of `general.externalEditor`**

Update line 157:
```typescript
const editor = useSettingsStore.getState().settings?.editor.externalEditor;
```

- [ ] **Step 4: Update `TabContent.tsx` — render TerminalPane for editor tabs with sessionId**

Update the `isAlwaysMounted` function to include editor tabs with sessions:

The editor case (lines 61-68) needs to check for `sessionId`:

```typescript
case "editor":
    label = tab.filePath?.split("/").pop() ?? "Editor";
    if (tab.sessionId) {
        // CLI editor running in terminal
        pane = (
            <TerminalPane
                taskId={workspace.task?.id}
                projectId={workspace.task ? undefined : workspace.project?.id}
                sessionId={tab.sessionId}
                visible={isActive}
            />
        );
        break;
    }
    // Monaco editor (no sessionId)
    if (!isActive) return null;
    pane = tab.filePath ? (
        <EditorPane filePath={tab.filePath} />
    ) : (
        <div className="text-muted-foreground p-3">No file specified</div>
    );
    break;
```

Update `isAlwaysMounted` to handle editor tabs with sessions:

```typescript
function isAlwaysMounted(tab: Tab): boolean {
    if (tab.type === "editor" && tab.sessionId) return true;
    return tab.type === "claude" || tab.type === "codex" || tab.type === "shell" || tab.type === "browser";
}
```

Note: `isAlwaysMounted` signature changes from taking `type` to taking the full `Tab` object, since we need to check `sessionId`. Update the call site at line 95 accordingly:
```typescript
if (isAlwaysMounted(tab)) {
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx packages/ui/src/components/workspace/TabContent.tsx
git commit -m "feat: route file opens through internalEditor setting, render CLI editors in terminal"
```

---

### Task 7: Settings UI — internal editor dropdown

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx:48-58,474-498`

- [ ] **Step 1: Remove hardcoded `EDITOR_OPTIONS` and make external editors dynamic from `SYSTEM_INFO`**

Replace the static `EDITOR_OPTIONS` (lines 48-58) with a dynamic approach. Add state for system editors:

```typescript
const [systemEditors, setSystemEditors] = useState<EditorInfo[]>([]);
```

Fetch them alongside other system info (in the existing useEffect that fetches shells/runtimes). The editors are already returned in `SYSTEM_INFO` — use that data.

- [ ] **Step 2: Add Internal Editor dropdown in the "defaults" section**

Add before the External Editor section:

```tsx
<section className="space-y-2">
    <h3 className="mb-0 text-sm font-medium">Internal Editor</h3>
    <div className="space-y-1">
        <Label className={defaultsSelectLabelClassName}>
            Used when opening files by clicking paths in the terminal
        </Label>
        <Select
            value={settings.editor.internalEditor}
            onValueChange={(value) =>
                updateSettings({ editor: { internalEditor: value } })
            }
        >
            <SelectTrigger className="h-8 w-full text-sm">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value="monaco">Monaco</SelectItem>
                {systemEditors
                    .filter((e) => e.type === "internal")
                    .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                            {e.name}
                        </SelectItem>
                    ))}
            </SelectContent>
        </Select>
    </div>
</section>
```

- [ ] **Step 3: Update External Editor dropdown to use dynamic editors + read from `editor.externalEditor`**

Replace the hardcoded `EDITOR_OPTIONS` mapping with dynamic entries from `systemEditors.filter(e => e.type === "external")`. Keep "System Default" as a static first option.

Update `handleExternalEditor` to write to `editor.externalEditor` instead of `general.externalEditor`:
```typescript
const handleExternalEditor = useCallback(
    (value: string) => updateSettings({ editor: { externalEditor: value } }),
    [updateSettings],
);
```

Update the value binding:
```typescript
value={settings.editor.externalEditor}
```

- [ ] **Step 4: Remove emacs from external editor list (already handled by dynamic approach)**

Since the dropdown now reads from `systemEditors.filter(e => e.type === "external")` and emacs is classified as `type: "internal"` in the detector, it will naturally not appear in the external dropdown.

- [ ] **Step 5: Add import for `EditorInfo` type**

```typescript
import type { EditorInfo } from "@taskflow/shared";
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: add internal editor dropdown, make external editor list dynamic"
```

---

### Task 8: Electron cleanup — remove emacs from external editor commands

**Files:**
- Modify: `electron/src/main.ts:624-643`

- [ ] **Step 1: Remove emacs entry from `editorCommands` in the `open-external-file` handler**

In `electron/src/main.ts` line 642, remove:
```typescript
emacs: () => ["emacs", line != null ? `+${line}:${col ?? 1}` : "+1", filePath],
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/main.ts
git commit -m "fix: remove emacs from external editor commands (now handled as internal CLI editor)"
```

---

### Task 9: Verify and fix — build check, type check, lint

- [ ] **Step 1: Run type check across all packages**

```bash
cd /Users/kuindji/Projects/taskflow/.worktrees/add-cli-editor-detection-and-terminal-integration
bun run --filter '*' typecheck
```

Expected: All packages compile cleanly.

- [ ] **Step 2: Run lint**

```bash
bun run --filter '*' lint
```

Expected: No new lint errors.

- [ ] **Step 3: Fix any issues found**

Address type errors, unused imports, lint warnings. Common issues to expect:
- Any code that reads `settings.general.externalEditor` needs to be updated to `settings.editor.externalEditor`
- The `normalizeSessionLabel` function may need the `"editor"` type added to its input type
- The `syncWithTasks`/`syncWithProjects` functions in session-store will work because `SessionRef.type` now includes `"editor"`

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address type and lint issues from CLI editor changes"
```

---

### Task 10: Edge case — fallback when selected editor is unavailable

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx` (the updated `openFileInApp`)
- Modify: `packages/ui/src/stores/settings-store.ts` (add cached editors)

There is no centralized store for `systemInfo` — it's fetched on-demand via `sendRequest(MSG.SYSTEM_INFO)`. For the fallback check in `openFileInApp` (a synchronous function), we need editors available synchronously. The simplest approach: cache the detected editors list in the settings store when `SettingsModal` fetches them, or add a module-level cache in `TerminalPane.tsx`.

- [ ] **Step 1: Add a module-level editors cache in `TerminalPane.tsx`**

Add near the top of `TerminalPane.tsx`, after other module-level state:

```typescript
let cachedEditors: EditorInfo[] = [];

async function refreshEditorCache(): Promise<void> {
    try {
        const info = await sendRequest<SystemInfo>(MSG.SYSTEM_INFO, {});
        cachedEditors = info.editors;
    } catch { /* keep existing cache */ }
}

// Fetch once on module load
void refreshEditorCache();
```

Import `EditorInfo` and `SystemInfo` from `@taskflow/shared`.

- [ ] **Step 2: Update `openFileInApp` to check editor availability**

```typescript
const editorAvailable = cachedEditors.some(
    (e) => e.id === internalEditor && e.type === "internal",
);

if (internalEditor === "monaco" || !editorAvailable) {
    // Monaco path...
} else if (owner) {
    // CLI editor path...
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "fix: fall back to Monaco when selected CLI editor is not available"
```
