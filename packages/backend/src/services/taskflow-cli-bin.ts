// Taskflow CLI — cross-platform TypeScript reimplementation of taskflow-cli.sh
// Compiled via `bun build --compile` to create a standalone binary.

const API_URL = process.env.TASKFLOW_API_URL;
if (!API_URL) {
    process.stderr.write("Error: TASKFLOW_API_URL is not set\n");
    process.exit(1);
}

let taskId = process.env.TASKFLOW_TASK_ID ?? "";
let projectId = process.env.TASKFLOW_PROJECT_ID ?? "";
const sessionId = process.env.TASKFLOW_SESSION_ID ?? "";
const flowId = process.env.TASKFLOW_FLOW_ID ?? "";
const actionEntryId = process.env.TASKFLOW_ACTION_ENTRY_ID ?? "";

// --- Helpers ---

async function api(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
): Promise<string> {
    const url = `${API_URL}${path}`;
    const headers: Record<string, string> = {};
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }
    if (extraHeaders) {
        Object.assign(headers, extraHeaders);
    }
    const resp = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        process.stderr.write(`Error: ${method} ${path} returned ${resp.status}: ${text}\n`);
        process.exit(1);
    }
    return resp.text();
}

function requireTaskId(): string {
    if (!taskId) {
        process.stderr.write("Error: TASKFLOW_TASK_ID is not set\n");
        process.exit(1);
    }
    return taskId;
}

function requireProjectId(): string {
    if (!projectId) {
        process.stderr.write("Error: TASKFLOW_PROJECT_ID is not set\n");
        process.exit(1);
    }
    return projectId;
}

function resolveOwnerId(): string {
    if (taskId) return taskId;
    if (projectId) return projectId;
    process.stderr.write("Error: neither TASKFLOW_TASK_ID nor TASKFLOW_PROJECT_ID is set\n");
    process.exit(1);
}

function requireFlowId(): string {
    if (!flowId) {
        process.stderr.write("Error: TASKFLOW_FLOW_ID is not set (not running as a flow action)\n");
        process.exit(1);
    }
    return flowId;
}

function requireSessionId(): string {
    if (!sessionId) {
        process.stderr.write("Error: TASKFLOW_SESSION_ID is not set\n");
        process.exit(1);
    }
    return sessionId;
}

function ownerField(): Record<string, string> {
    if (taskId) return { taskId };
    if (projectId) return { projectId };
    process.stderr.write("Error: neither TASKFLOW_TASK_ID nor TASKFLOW_PROJECT_ID is set\n");
    process.exit(1);
}

interface ParsedItem {
    id?: string;
    [key: string]: unknown;
}

function findById(items: ParsedItem[], id: string, label: string): ParsedItem {
    const item = items.find((it) => it.id === id);
    if (!item) {
        process.stderr.write(`Error: ${label} not found: ${id}\n`);
        process.exit(1);
    }
    return item;
}

// --- Parse global flags (--task, --project-id) ---
const rawArgs = process.argv.slice(2);
let argIndex = 0;

while (argIndex < rawArgs.length) {
    if (rawArgs[argIndex] === "--task") {
        taskId = rawArgs[argIndex + 1] ?? "";
        argIndex += 2;
    } else if (rawArgs[argIndex] === "--project-id") {
        projectId = rawArgs[argIndex + 1] ?? "";
        argIndex += 2;
    } else {
        break;
    }
}

const cmd = rawArgs[argIndex] ?? "";
const rest = rawArgs.slice(argIndex + 1);

// --- Flag parsing helpers ---

function consumeFlags(
    args: string[],
    spec: Record<string, "string" | "boolean">,
): { flags: Record<string, string | boolean>; positional: string[] } {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const name = arg.slice(2);
            const kind = spec[name];
            if (kind === "boolean") {
                flags[name] = true;
                i++;
            } else if (kind === "string") {
                flags[name] = args[i + 1] ?? "";
                i += 2;
            } else {
                // Unknown flag: skip
                i++;
            }
        } else {
            positional.push(arg);
            i++;
        }
    }
    return { flags, positional };
}

// --- Command handlers ---

async function handleTask(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";

    if (subcmd === "worktree") {
        requireTaskId();
        const { flags } = consumeFlags(args.slice(1), { disable: "boolean" });
        if (flags.disable) {
            process.stdout.write(
                await api("PATCH", `/api/tasks/${taskId}/worktree`, { enabled: false }),
            );
        } else {
            process.stderr.write("Usage: taskflow-cli task worktree --disable\n");
            process.exit(1);
        }
    } else if (subcmd === "list") {
        requireProjectId();
        process.stdout.write(await api("GET", `/api/projects/${projectId}/tasks`));
    } else if (subcmd === "list-archived") {
        process.stdout.write(await api("GET", "/api/tasks/archived"));
    } else if (subcmd === "create") {
        const description = args[1] ?? "";
        if (!description) {
            process.stderr.write(
                "Usage: taskflow-cli task create <description> [--title <title>] [--worktree] [--init <command>] [--parent <taskId>]\n",
            );
            process.exit(1);
        }
        const { flags } = consumeFlags(args.slice(2), {
            title: "string",
            worktree: "boolean",
            init: "string",
            parent: "string",
        });

        const parentFlag = typeof flags.parent === "string" ? flags.parent : "";
        let parentId: string | undefined;
        let targetProjectId: string;

        if (taskId) {
            if (parentFlag && parentFlag !== taskId) {
                process.stderr.write(
                    "Error: cannot create a subtask under a different task while running in task context\n",
                );
                process.exit(1);
            }
            parentId = taskId;
            targetProjectId = requireProjectId();
        } else if (parentFlag) {
            const parentRaw = await api("GET", `/api/tasks/${parentFlag}`);
            const parent = (JSON.parse(parentRaw) as { task?: { projectId?: string } }).task;
            if (!parent?.projectId) {
                process.stderr.write(`Error: parent task not found or missing project: ${parentFlag}\n`);
                process.exit(1);
            }
            parentId = parentFlag;
            targetProjectId = parent.projectId;
        } else {
            targetProjectId = requireProjectId();
        }

        if (parentId && flags.worktree) {
            process.stderr.write("Error: --worktree is not allowed when creating a subtask\n");
            process.exit(1);
        }

        const body: Record<string, unknown> = { description };
        if (flags.title) body.title = flags.title;
        if (flags.worktree) body.worktree = true;
        if (flags.init) body.initCommand = flags.init;
        if (parentId) body.parentId = parentId;
        process.stdout.write(await api("POST", `/api/projects/${targetProjectId}/tasks`, body));
    } else if (subcmd === "update") {
        requireTaskId();
        const { flags } = consumeFlags(args.slice(1), {
            title: "string",
            description: "string",
            notes: "string",
            pin: "boolean",
            unpin: "boolean",
        });
        const body: Record<string, unknown> = {};
        if (flags.title !== undefined) body.title = flags.title;
        if (flags.description !== undefined) body.description = flags.description;
        if (flags.notes !== undefined) body.notes = flags.notes;
        if (flags.pin) body.pinned = true;
        if (flags.unpin) body.pinned = false;
        if (Object.keys(body).length === 0) {
            process.stderr.write(
                "Usage: taskflow-cli task update [--title t] [--description d] [--notes n] [--pin] [--unpin]\n",
            );
            process.exit(1);
        }
        process.stdout.write(await api("PATCH", `/api/tasks/${taskId}`, body));
    } else if (subcmd === "archive") {
        requireTaskId();
        process.stdout.write(await api("POST", `/api/tasks/${taskId}/archive`));
    } else if (subcmd === "unarchive") {
        requireTaskId();
        process.stdout.write(await api("POST", `/api/tasks/${taskId}/unarchive`));
    } else if (subcmd === "delete") {
        requireTaskId();
        const { flags } = consumeFlags(args.slice(1), { "delete-worktree": "boolean" });
        if (flags["delete-worktree"]) {
            process.stdout.write(
                await api("DELETE", `/api/tasks/${taskId}`, { deleteWorktree: true }),
            );
        } else {
            process.stdout.write(await api("DELETE", `/api/tasks/${taskId}`));
        }
    } else {
        // No subcommand — get current task
        requireTaskId();
        process.stdout.write(await api("GET", `/api/tasks/${taskId}`));
    }
}

async function handleLog(args: string[]): Promise<void> {
    requireTaskId();
    const logType = args[0] ?? "";
    const logMessage = args[1] ?? "";
    if (!logType || !logMessage) {
        process.stderr.write("Usage: taskflow-cli log <type> <message> [--hash <hash>]\n");
        process.exit(1);
    }
    const { flags } = consumeFlags(args.slice(2), { hash: "string" });
    const body: Record<string, unknown> = {
        type: logType,
        message: logMessage,
        sessionId,
    };
    if (flags.hash) {
        body.meta = { hash: flags.hash };
    }
    process.stdout.write(await api("POST", `/api/tasks/${taskId}/log`, body));
}

async function handleBrowser(args: string[]): Promise<void> {
    const url = args[0] ?? "";
    if (!url) {
        process.stderr.write("Usage: taskflow-cli browser <url> [--label <label>] [--project]\n");
        process.exit(1);
    }
    const { flags } = consumeFlags(args.slice(1), { label: "string", project: "boolean" });
    const body: Record<string, unknown> = { url };
    if (flags.label) body.label = flags.label;

    let endpoint: string;
    if (flags.project) {
        requireProjectId();
        endpoint = `/api/projects/${projectId}/browser`;
    } else {
        requireTaskId();
        endpoint = `/api/tasks/${taskId}/browser`;
    }
    process.stdout.write(await api("POST", endpoint, body));
}

async function handleAction(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "complete": {
            requireFlowId();
            const of = ownerField();
            process.stdout.write(
                await api("POST", "/api/flow/action-complete", {
                    ...of,
                    flowId,
                    sessionId,
                }),
            );
            break;
        }
        case "list":
            process.stdout.write(await api("GET", "/api/flow-actions"));
            break;
        case "get": {
            const actionId = subArgs[0] ?? "";
            if (!actionId) {
                process.stderr.write("Usage: taskflow-cli action get <id>\n");
                process.exit(1);
            }
            const allActions = JSON.parse(await api("GET", "/api/flow-actions")) as ParsedItem[];
            const action = findById(allActions, actionId, "Action");
            process.stdout.write(JSON.stringify(action));
            break;
        }
        case "create": {
            const { flags } = consumeFlags(subArgs, {
                name: "string",
                prompt: "string",
                "session-type": "string",
                standalone: "boolean",
            });
            if (!flags.name || !flags.prompt) {
                process.stderr.write(
                    "Usage: taskflow-cli action create --name <name> --prompt <prompt> [--session-type claude] [--standalone]\n",
                );
                process.exit(1);
            }
            const now = new Date().toISOString();
            const body: Record<string, unknown> = {
                id: crypto.randomUUID(),
                name: flags.name,
                prompt: flags.prompt,
                sessionType: flags["session-type"] || "claude",
                standalone: flags.standalone ?? false,
                createdAt: now,
                updatedAt: now,
            };
            if (projectId) body.projectId = projectId;
            process.stdout.write(await api("POST", "/api/flow-actions", body));
            break;
        }
        case "update": {
            const actionId = subArgs[0] ?? "";
            if (!actionId) {
                process.stderr.write(
                    "Usage: taskflow-cli action update <id> [--name n] [--prompt p] [--session-type t] [--standalone] [--no-standalone]\n",
                );
                process.exit(1);
            }
            const allActions = JSON.parse(await api("GET", "/api/flow-actions")) as ParsedItem[];
            const existing = findById(allActions, actionId, "Action");
            const { flags } = consumeFlags(subArgs.slice(1), {
                name: "string",
                prompt: "string",
                "session-type": "string",
                standalone: "boolean",
                "no-standalone": "boolean",
            });
            const overlay: Record<string, unknown> = {};
            if (flags.name !== undefined) overlay.name = flags.name;
            if (flags.prompt !== undefined) overlay.prompt = flags.prompt;
            if (flags["session-type"] !== undefined) overlay.sessionType = flags["session-type"];
            if (flags.standalone) overlay.standalone = true;
            if (flags["no-standalone"]) overlay.standalone = false;
            if (Object.keys(overlay).length === 0) {
                process.stderr.write("No update fields provided\n");
                process.exit(1);
            }
            overlay.updatedAt = new Date().toISOString();
            const merged = { ...existing, ...overlay };
            process.stdout.write(await api("POST", "/api/flow-actions", merged));
            break;
        }
        case "delete": {
            const actionId = subArgs[0] ?? "";
            if (!actionId) {
                process.stderr.write("Usage: taskflow-cli action delete <id>\n");
                process.exit(1);
            }
            process.stdout.write(await api("DELETE", `/api/flow-actions/${actionId}`));
            break;
        }
        case "run": {
            const actionId = subArgs[0] ?? "";
            if (!actionId) {
                process.stderr.write(
                    "Usage: taskflow-cli action run <id> [--prompt <prompt>] [--label <label>]\n",
                );
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), { prompt: "string", label: "string" });
            const body: Record<string, unknown> = ownerField();
            if (flags.prompt) body.prompt = flags.prompt;
            if (flags.label) body.label = flags.label;
            process.stdout.write(await api("POST", `/api/flow-actions/${actionId}/run`, body));
            break;
        }
        default:
            process.stderr.write(
                "Usage: taskflow-cli action <complete|list|get|create|update|delete|run>\n",
            );
            process.exit(1);
    }
}

async function handleArtifact(args: string[]): Promise<void> {
    requireFlowId();
    const ownerId = resolveOwnerId();
    const of = ownerField();
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "save": {
            const artifactType = subArgs[0] ?? "";
            if (!artifactType) {
                process.stderr.write(
                    "Usage: taskflow-cli artifact save <type> --path <path> | --text <text>\n",
                );
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), { path: "string", text: "string" });
            if (flags.path && flags.text) {
                process.stderr.write("Use either --path or --text, not both\n");
                process.exit(1);
            }
            if (!flags.path && !flags.text) {
                process.stderr.write("Either --path or --text is required\n");
                process.exit(1);
            }
            const body: Record<string, unknown> = {
                ...of,
                flowId,
                actionEntryId,
                sessionId,
                type: artifactType,
            };
            if (flags.path) body.path = flags.path;
            if (flags.text) body.text = flags.text;
            process.stdout.write(await api("POST", "/api/flow/artifact", body));
            break;
        }
        case "list":
            process.stdout.write(await api("GET", `/api/flow/artifact/${ownerId}/${flowId}`));
            break;
        case "get": {
            const artifactType = subArgs[0] ?? "";
            if (!artifactType) {
                process.stderr.write("Usage: taskflow-cli artifact get <type>\n");
                process.exit(1);
            }
            process.stdout.write(
                await api("GET", `/api/flow/artifact/${ownerId}/${flowId}/${artifactType}`),
            );
            break;
        }
        default:
            process.stderr.write("Usage: taskflow-cli artifact <save|list|get>\n");
            process.exit(1);
    }
}

async function handleFlow(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "input": {
            requireFlowId();
            const ownerId = resolveOwnerId();
            const inputId = subArgs[0] ?? "";
            if (inputId) {
                process.stdout.write(
                    await api("GET", `/api/flow/input/${ownerId}/${flowId}/${inputId}`),
                );
            } else {
                process.stdout.write(await api("GET", `/api/flow/input/${ownerId}/${flowId}`));
            }
            break;
        }
        case "list":
            process.stdout.write(await api("GET", "/api/flows"));
            break;
        case "actions":
            process.stdout.write(await api("GET", "/api/flow-actions"));
            break;
        case "start": {
            const startFlowId = subArgs[0] ?? "";
            if (!startFlowId) {
                process.stderr.write(
                    "Usage: taskflow-cli flow start <flowId> [--input key=value ...]\n",
                );
                process.exit(1);
            }
            resolveOwnerId(); // validates
            const body: Record<string, unknown> = {
                ...ownerField(),
                flowId: startFlowId,
            };
            // Collect --input key=value pairs
            const inputValues: Record<string, string> = {};
            let i = 1;
            while (i < subArgs.length) {
                if (subArgs[i] === "--input") {
                    const kv = subArgs[i + 1] ?? "";
                    const eqIdx = kv.indexOf("=");
                    if (eqIdx > 0) {
                        inputValues[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
                    }
                    i += 2;
                } else {
                    i++;
                }
            }
            if (Object.keys(inputValues).length > 0) {
                body.inputValues = inputValues;
            }
            process.stdout.write(await api("POST", "/api/flows/start", body));
            break;
        }
        case "stop": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow stop <flowId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/flows/${ownerId}/${fId}/stop`));
            break;
        }
        case "pause": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow pause <flowId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/flows/${ownerId}/${fId}/pause`));
            break;
        }
        case "resume": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow resume <flowId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/flows/${ownerId}/${fId}/resume`));
            break;
        }
        case "skip": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow skip <flowId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/flows/${ownerId}/${fId}/skip`));
            break;
        }
        case "jump": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            const actionIndex = subArgs[1] ?? "";
            if (!fId || !actionIndex) {
                process.stderr.write("Usage: taskflow-cli flow jump <flowId> <actionIndex>\n");
                process.exit(1);
            }
            const idx = Number(actionIndex);
            if (!Number.isInteger(idx) || idx < 0) {
                process.stderr.write("Error: actionIndex must be a non-negative integer\n");
                process.exit(1);
            }
            process.stdout.write(
                await api("POST", `/api/flows/${ownerId}/${fId}/jump`, { actionIndex: idx }),
            );
            break;
        }
        case "status": {
            const ownerId = resolveOwnerId();
            const fId = subArgs[0] ?? "";
            if (fId) {
                process.stdout.write(await api("GET", `/api/flow-runs/${ownerId}/${fId}`));
            } else {
                process.stdout.write(await api("GET", `/api/flow-runs/${ownerId}`));
            }
            break;
        }
        case "get": {
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow get <id>\n");
                process.exit(1);
            }
            const allFlows = JSON.parse(await api("GET", "/api/flows")) as ParsedItem[];
            const flow = findById(allFlows, fId, "Flow");
            process.stdout.write(JSON.stringify(flow));
            break;
        }
        case "create": {
            const { flags } = consumeFlags(subArgs, {
                name: "string",
                description: "string",
            });
            // Collect --action flags manually since consumeFlags doesn't handle repeated flags
            const actionIds: string[] = [];
            let j = 0;
            while (j < subArgs.length) {
                if (subArgs[j] === "--action") {
                    actionIds.push(subArgs[j + 1] ?? "");
                    j += 2;
                } else {
                    j++;
                }
            }
            if (!flags.name) {
                process.stderr.write(
                    "Usage: taskflow-cli flow create --name <name> --description <desc> [--action <actionId> ...]\n",
                );
                process.exit(1);
            }
            const now = new Date().toISOString();
            const actions = actionIds.map((aid) => ({
                id: crypto.randomUUID(),
                actionId: aid,
            }));
            const body: Record<string, unknown> = {
                id: crypto.randomUUID(),
                name: flags.name,
                description: flags.description ?? "",
                actions,
                createdAt: now,
                updatedAt: now,
            };
            if (projectId) body.projectId = projectId;
            process.stdout.write(await api("POST", "/api/flows", body));
            break;
        }
        case "update": {
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write(
                    "Usage: taskflow-cli flow update <id> [--name n] [--description d]\n",
                );
                process.exit(1);
            }
            const allFlows = JSON.parse(await api("GET", "/api/flows")) as ParsedItem[];
            const existing = findById(allFlows, fId, "Flow");
            const { flags } = consumeFlags(subArgs.slice(1), {
                name: "string",
                description: "string",
            });
            const overlay: Record<string, unknown> = {};
            if (flags.name !== undefined) overlay.name = flags.name;
            if (flags.description !== undefined) overlay.description = flags.description;
            if (Object.keys(overlay).length === 0) {
                process.stderr.write("No update fields provided\n");
                process.exit(1);
            }
            overlay.updatedAt = new Date().toISOString();
            const merged = { ...existing, ...overlay };
            process.stdout.write(await api("POST", "/api/flows", merged));
            break;
        }
        case "delete": {
            const fId = subArgs[0] ?? "";
            if (!fId) {
                process.stderr.write("Usage: taskflow-cli flow delete <id>\n");
                process.exit(1);
            }
            process.stdout.write(await api("DELETE", `/api/flows/${fId}`));
            break;
        }
        default:
            process.stderr.write(
                "Usage: taskflow-cli flow <list|get|actions|create|update|delete|start|stop|pause|resume|skip|jump|run|runs|input>\n",
            );
            process.exit(1);
    }
}

async function handleNotify(args: string[]): Promise<void> {
    const message = args[0] ?? "";
    if (!message) {
        process.stderr.write("Usage: taskflow-cli notify <message>\n");
        process.exit(1);
    }
    requireProjectId();
    requireSessionId();
    const headers: Record<string, string> = {
        "X-Taskflow-Project-Id": projectId,
        "X-Taskflow-Session-Id": sessionId,
    };
    if (taskId) {
        headers["X-Taskflow-Task-Id"] = taskId;
    }
    process.stdout.write(await api("POST", "/api/notifications", { message }, headers));
}

async function handleProject(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "list":
            process.stdout.write(await api("GET", "/api/projects"));
            break;
        case "add": {
            const projPath = subArgs[0] ?? "";
            if (!projPath) {
                process.stderr.write("Usage: taskflow-cli project add <path> [--name <name>]\n");
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), { name: "string" });
            const body: Record<string, unknown> = { path: projPath };
            if (flags.name) body.name = flags.name;
            process.stdout.write(await api("POST", "/api/projects", body));
            break;
        }
        case "remove": {
            const projId = subArgs[0] ?? "";
            if (!projId) {
                process.stderr.write("Usage: taskflow-cli project remove <id>\n");
                process.exit(1);
            }
            process.stdout.write(await api("DELETE", `/api/projects/${projId}`));
            break;
        }
        case "update": {
            const projId = subArgs[0] ?? "";
            if (!projId) {
                process.stderr.write(
                    "Usage: taskflow-cli project update <id> [--name n] [--path p] [--hidden] [--visible]\n",
                );
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), {
                name: "string",
                path: "string",
                hidden: "boolean",
                visible: "boolean",
            });
            const body: Record<string, unknown> = {};
            if (flags.name !== undefined) body.name = flags.name;
            if (flags.path !== undefined) body.path = flags.path;
            if (flags.hidden) body.hidden = true;
            if (flags.visible) body.hidden = false;
            if (Object.keys(body).length === 0) {
                process.stderr.write("No update fields provided\n");
                process.exit(1);
            }
            process.stdout.write(await api("PATCH", `/api/projects/${projId}`, body));
            break;
        }
        case "fork": {
            const projId = subArgs[0] ?? "";
            const branch = subArgs[1] ?? "";
            if (!projId || !branch) {
                process.stderr.write(
                    "Usage: taskflow-cli project fork <id> <branch> [--folder <name>]\n",
                );
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(2), { folder: "string" });
            const body: Record<string, unknown> = { branch };
            if (flags.folder) body.folderName = flags.folder;
            process.stdout.write(await api("POST", `/api/projects/${projId}/fork`, body));
            break;
        }
        default:
            process.stderr.write("Usage: taskflow-cli project <list|add|remove|update|fork>\n");
            process.exit(1);
    }
}

async function handleSchedule(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "complete": {
            requireSessionId();
            process.stdout.write(await api("POST", "/api/schedules/complete", { sessionId }));
            break;
        }
        case "list": {
            if (projectId) {
                process.stdout.write(await api("GET", `/api/schedules?projectId=${projectId}`));
            } else {
                process.stdout.write(await api("GET", "/api/schedules"));
            }
            break;
        }
        case "create": {
            requireProjectId();
            const { flags } = consumeFlags(subArgs, {
                expression: "string",
                type: "string",
                prompt: "string",
                name: "string",
                timeout: "string",
                agent: "string",
                foreground: "boolean",
                background: "boolean",
            });
            if (!flags.expression) {
                process.stderr.write(
                    "Usage: taskflow-cli schedule create --expression <expr> [--type cron|rate] [--prompt p] [--name n] [--timeout m] [--agent type] [--foreground]\n",
                );
                process.exit(1);
            }
            const body: Record<string, unknown> = {
                projectId,
                expression: flags.expression,
                expressionType: (flags.type as string) || "rate",
            };
            if (flags.prompt) body.prompt = flags.prompt;
            if (flags.name) body.name = flags.name;
            if (flags.timeout) {
                const t = Number(flags.timeout);
                if (!Number.isInteger(t) || t <= 0) {
                    process.stderr.write("Error: timeout must be a positive integer (minutes)\n");
                    process.exit(1);
                }
                body.timeout = t;
            }
            if (flags.agent) body.agentType = flags.agent;
            if (flags.foreground) body.executionMode = "foreground";
            else if (flags.background) body.executionMode = "background";
            process.stdout.write(await api("POST", "/api/schedules", body));
            break;
        }
        case "update": {
            const schedId = subArgs[0] ?? "";
            if (!schedId) {
                process.stderr.write(
                    "Usage: taskflow-cli schedule update <id> [--name n] [--prompt p] [--expression e] [--type cron|rate] [--timeout m] [--enable] [--disable] [--foreground] [--background]\n",
                );
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), {
                name: "string",
                prompt: "string",
                expression: "string",
                type: "string",
                timeout: "string",
                enable: "boolean",
                disable: "boolean",
                foreground: "boolean",
                background: "boolean",
            });
            const body: Record<string, unknown> = {};
            if (flags.name !== undefined) body.name = flags.name;
            if (flags.prompt !== undefined) body.prompt = flags.prompt;
            if (flags.expression !== undefined) body.expression = flags.expression;
            if (flags.type !== undefined) body.expressionType = flags.type;
            if (flags.timeout !== undefined) {
                const t = Number(flags.timeout);
                if (!Number.isInteger(t) || t <= 0) {
                    process.stderr.write("Error: timeout must be a positive integer (minutes)\n");
                    process.exit(1);
                }
                body.timeout = t;
            }
            if (flags.enable) body.enabled = true;
            if (flags.disable) body.enabled = false;
            if (flags.foreground) body.executionMode = "foreground";
            else if (flags.background) body.executionMode = "background";
            if (Object.keys(body).length === 0) {
                process.stderr.write("No update fields provided\n");
                process.exit(1);
            }
            process.stdout.write(await api("PATCH", `/api/schedules/${schedId}`, body));
            break;
        }
        case "delete": {
            const schedId = subArgs[0] ?? "";
            if (!schedId) {
                process.stderr.write("Usage: taskflow-cli schedule delete <id>\n");
                process.exit(1);
            }
            process.stdout.write(await api("DELETE", `/api/schedules/${schedId}`));
            break;
        }
        case "trigger": {
            const schedId = subArgs[0] ?? "";
            if (!schedId) {
                process.stderr.write("Usage: taskflow-cli schedule trigger <id>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/schedules/${schedId}/trigger`));
            break;
        }
        default:
            process.stderr.write(
                "Usage: taskflow-cli schedule <complete|list|create|update|delete|trigger>\n",
            );
            process.exit(1);
    }
}

async function handleAgent(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "list":
            process.stdout.write(await api("GET", "/api/agents"));
            break;
        case "run": {
            requireProjectId();
            // First positional arg is agent type (optional — if it starts with --, it's a flag)
            let agentType = "";
            let flagArgs = subArgs;
            if (subArgs.length > 0 && !subArgs[0].startsWith("--")) {
                agentType = subArgs[0];
                flagArgs = subArgs.slice(1);
            }

            const { flags } = consumeFlags(flagArgs, {
                prompt: "string",
                task: "string",
                label: "string",
                model: "string",
                // Claude
                "dangerously-skip-permissions": "boolean",
                "permission-mode": "string",
                effort: "string",
                // Codex
                sandbox: "string",
                "approval-policy": "string",
                "full-auto": "boolean",
                // OpenCode
                variant: "string",
                "auto-approve": "boolean",
                // Gemini
                "approval-mode": "string",
                "gemini-sandbox": "boolean",
                // Cursor
                yolo: "boolean",
            });

            const body: Record<string, unknown> = { projectId };
            if (agentType) body.type = agentType;

            const resolvedTaskId = (flags.task as string) || taskId;
            if (resolvedTaskId) body.taskId = resolvedTaskId;
            if (flags.prompt) body.prompt = flags.prompt;
            if (flags.label) body.label = flags.label;

            // Build agentOptions
            const agentOptions: Record<string, unknown> = {};
            if (agentType) agentOptions.type = agentType;

            if (agentType === "claude") {
                if (flags["dangerously-skip-permissions"])
                    agentOptions.dangerouslySkipPermissions = true;
                if (flags["permission-mode"])
                    agentOptions.permissionMode = flags["permission-mode"];
                if (flags.effort) agentOptions.effort = flags.effort;
            } else if (agentType === "codex") {
                if (flags["full-auto"]) agentOptions.fullAuto = true;
                if (flags.sandbox) agentOptions.sandbox = flags.sandbox;
                if (flags["approval-policy"])
                    agentOptions.approvalPolicy = flags["approval-policy"];
            } else if (agentType === "opencode") {
                if (flags.variant) agentOptions.variant = flags.variant;
                if (flags["auto-approve"]) agentOptions.autoApprove = true;
            } else if (agentType === "gemini") {
                if (flags["approval-mode"]) agentOptions.approvalMode = flags["approval-mode"];
                if (flags["gemini-sandbox"]) agentOptions.sandbox = true;
            } else if (agentType === "cursor") {
                if (flags.yolo) agentOptions.yolo = true;
            }

            if (flags.model) agentOptions.model = flags.model;

            if (Object.keys(agentOptions).length > 0) {
                body.agentOptions = agentOptions;
            }

            process.stdout.write(await api("POST", "/api/sessions", body));
            break;
        }
        default:
            process.stderr.write("Usage: taskflow-cli agent <list|run>\n");
            process.exit(1);
    }
}

async function handleSession(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "rename": {
            const sessId = subArgs[0] ?? "";
            const label = subArgs[1] ?? "";
            if (!sessId || !label) {
                process.stderr.write("Usage: taskflow-cli session rename <sessionId> <label>\n");
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/sessions/${sessId}/rename`, { label }));
            break;
        }
        case "snapshot": {
            const sessId = subArgs[0] ?? "";
            if (!sessId) {
                process.stderr.write("Usage: taskflow-cli session snapshot <sessionId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("GET", `/api/sessions/${sessId}/snapshot`));
            break;
        }
        case "close": {
            const sessId = subArgs[0] || sessionId;
            if (!sessId) {
                process.stderr.write("Usage: taskflow-cli session close [sessionId]\n");
                process.stderr.write(
                    "  If no sessionId is provided, closes the current session (using TASKFLOW_SESSION_ID).\n",
                );
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/sessions/${sessId}/done`));
            break;
        }
        case "status": {
            const sessId = subArgs[0] ?? "";
            if (!sessId) {
                process.stderr.write("Usage: taskflow-cli session status <sessionId>\n");
                process.exit(1);
            }
            process.stdout.write(await api("GET", `/api/sessions/${sessId}/status`));
            break;
        }
        case "input": {
            const sessId = subArgs[0] ?? "";
            // Remaining args (except --raw) form the message
            let rawFlag = false;
            const msgParts: string[] = [];
            for (const arg of subArgs.slice(1)) {
                if (arg === "--raw") {
                    rawFlag = true;
                } else {
                    msgParts.push(arg);
                }
            }
            const sessMsg = msgParts.join(" ");
            if (!sessId || !sessMsg) {
                process.stderr.write(
                    "Usage: taskflow-cli session input <sessionId> <message> [--raw]\n",
                );
                process.exit(1);
            }
            process.stdout.write(
                await api("POST", `/api/sessions/${sessId}/input`, { data: sessMsg, raw: rawFlag }),
            );
            break;
        }
        case "tail": {
            const sessId = subArgs[0] ?? "";
            if (!sessId) {
                process.stderr.write("Usage: taskflow-cli session tail <sessionId> [--lines N]\n");
                process.exit(1);
            }
            const { flags } = consumeFlags(subArgs.slice(1), { lines: "string" });
            const lines = flags.lines ? Number(flags.lines) : 100;
            process.stdout.write(await api("GET", `/api/sessions/${sessId}/tail?lines=${lines}`));
            break;
        }
        default:
            process.stderr.write(
                "Usage: taskflow-cli session <rename|snapshot|close|status|input|tail>\n",
            );
            process.exit(1);
    }
}

async function handleSystem(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    switch (subcmd) {
        case "info":
            process.stdout.write(await api("GET", "/api/system/info"));
            break;
        case "shells":
            process.stdout.write(await api("GET", "/api/shells"));
            break;
        case "runtimes":
            process.stdout.write(await api("GET", "/api/runtimes"));
            break;
        default:
            process.stderr.write("Usage: taskflow-cli system <info|shells|runtimes>\n");
            process.exit(1);
    }
}

async function handleSettings(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    switch (subcmd) {
        case "get":
            process.stdout.write(await api("GET", "/api/settings"));
            break;
        default:
            process.stderr.write("Usage: taskflow-cli settings <get>\n");
            process.exit(1);
    }
}

// --- Main dispatch ---

async function main(): Promise<void> {
    if (rawArgs.some((a) => a === "--help" || a === "-h")) {
        process.stdout.write(await api("GET", "/api/cli-help"));
        return;
    }
    switch (cmd) {
        case "task":
            await handleTask(rest);
            break;
        case "log":
            await handleLog(rest);
            break;
        case "browser":
            await handleBrowser(rest);
            break;
        case "action":
            await handleAction(rest);
            break;
        case "artifact":
            await handleArtifact(rest);
            break;
        case "flow":
            await handleFlow(rest);
            break;
        case "notify":
            await handleNotify(rest);
            break;
        case "project":
            await handleProject(rest);
            break;
        case "schedule":
            await handleSchedule(rest);
            break;
        case "agent":
            await handleAgent(rest);
            break;
        case "session":
            await handleSession(rest);
            break;
        case "system":
            await handleSystem(rest);
            break;
        case "settings":
            await handleSettings(rest);
            break;
        case "app-name":
            process.stdout.write(await api("GET", "/api/app-name"));
            break;
        case "help":
        case "--help":
        case "-h":
            process.stdout.write(await api("GET", "/api/cli-help"));
            break;
        default:
            process.stderr.write(await api("GET", "/api/cli-help"));
            process.exit(1);
    }
}

main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
    process.exit(1);
});
