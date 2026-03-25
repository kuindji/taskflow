import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import type { FlowStore } from "../../services/flow-store";
import type { FlowRunner } from "../../services/flow-runner";
import type { SchedulerService } from "../../services/scheduler-service";
import type {
    ActionDefinition,
    AgentAvailability,
    AgentType,
    FlowDefinition,
    WsEvent,
} from "@taskflow/shared";
import type { CreateSessionOpts } from "../../services/session-lifecycle";
import { jsonResponse, errorResponse } from "./response-helpers";

interface FlowRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
    broadcast: (event: WsEvent) => void;
    agents: AgentAvailability[];
    schedulerService: SchedulerService;
    sessionLifecycle: {
        createSession: (opts: CreateSessionOpts) => Promise<string>;
    };
}

function registerFlowRoutes(deps: FlowRouteDeps): void {
    const {
        apiRouter,
        taskStore,
        flowStore,
        flowRunner,
        agents,
        sessionLifecycle,
        schedulerService,
    } = deps;

    const availableAgentTypes = new Set(agents.filter((a) => a.available).map((a) => a.type));

    // --- Flow action completion ---

    apiRouter.register("POST", "/api/flow/action-complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, sessionId } = body;
        const ownerId =
            typeof taskId === "string"
                ? taskId
                : typeof projectId === "string"
                  ? projectId
                  : undefined;
        if (!ownerId || typeof flowId !== "string" || typeof sessionId !== "string") {
            return errorResponse(
                "Fields flowId, sessionId, and one of taskId/projectId are required strings",
                400,
            );
        }

        try {
            await flowRunner.handleActionComplete(ownerId, flowId, sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // --- Schedule completion ---

    apiRouter.register("POST", "/api/schedules/complete", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { sessionId } = body;
        if (typeof sessionId !== "string") {
            return errorResponse("sessionId is required as a string", 400);
        }

        try {
            await schedulerService.handleComplete(sessionId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // --- Flow artifacts ---

    apiRouter.register("POST", "/api/flow/artifact", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, actionEntryId, sessionId, type, path, text } = body;
        const ownerId =
            typeof taskId === "string"
                ? taskId
                : typeof projectId === "string"
                  ? projectId
                  : undefined;
        if (
            !ownerId ||
            typeof flowId !== "string" ||
            typeof actionEntryId !== "string" ||
            typeof sessionId !== "string" ||
            typeof type !== "string"
        ) {
            return errorResponse(
                "Fields flowId, actionEntryId, sessionId, type, and one of taskId/projectId are required strings",
                400,
            );
        }

        const hasPath = typeof path === "string";
        const hasText = typeof text === "string";
        if (hasPath === hasText) {
            return errorResponse("Exactly one of path or text is required", 400);
        }

        try {
            await flowRunner.saveArtifact(ownerId, flowId, actionEntryId, sessionId, {
                type,
                path: hasPath ? path : undefined,
                text: hasText ? text : undefined,
            });
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            if (message === "No flow run found") {
                return errorResponse(message, 404);
            }
            if (
                message === "Flow run is not active" ||
                message === "No running action available for artifact save" ||
                message === "Artifacts can only be saved for the current action" ||
                message === "Artifacts can only be saved by the active action session" ||
                message === "Artifact must include exactly one of path or text"
            ) {
                return errorResponse(message, 409);
            }
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/flow/artifact/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ artifacts: flowRunner.getArtifacts(run) });
    });

    apiRouter.register("GET", "/api/flow/artifact/:ownerId/:flowId/:type", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        const artifacts = flowRunner.getArtifacts(run, params.type);
        if (artifacts.length === 0) return errorResponse("Artifact not found", 404);
        return jsonResponse(artifacts[0]);
    });

    // --- Flow input values ---

    apiRouter.register("GET", "/api/flow/input/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse({ inputValues: run.inputValues ?? {} });
    });

    apiRouter.register("GET", "/api/flow/input/:ownerId/:flowId/:inputId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        const value = run.inputValues?.[params.inputId];
        if (value === undefined) {
            return errorResponse(`Input "${params.inputId}" not found`, 404);
        }
        // Return plain text for easy CLI consumption (no JSON parsing needed)
        return new Response(value, {
            status: 200,
            headers: { "Content-Type": "text/plain" },
        });
    });

    // ── Flow definitions CRUD ──────────────────────────────────────

    apiRouter.register("GET", "/api/flows", async () => {
        return jsonResponse({ flows: await flowStore.getFlows() });
    });

    apiRouter.register("GET", "/api/flow-actions", async () => {
        return jsonResponse({ actions: await flowStore.getActions() });
    });

    apiRouter.register("POST", "/api/flows", async (req) => {
        let body: FlowDefinition;
        try {
            body = (await req.json()) as FlowDefinition;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        try {
            await flowStore.saveFlow(body);
            return jsonResponse(body, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flow-actions", async (req) => {
        let body: ActionDefinition;
        try {
            body = (await req.json()) as ActionDefinition;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        try {
            await flowStore.saveAction(body);
            return jsonResponse(body, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/flows/:id", async (_req, params) => {
        try {
            await flowStore.deleteFlow(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("DELETE", "/api/flow-actions/:id", async (_req, params) => {
        try {
            const referencingFlows = await flowStore.getFlowsReferencingAction(params.id);
            if (referencingFlows.length > 0) {
                return errorResponse(
                    `Cannot delete action "${params.id}" because it is used by: ${referencingFlows.map((f) => f.name).join(", ")}`,
                    409,
                );
            }
            await flowStore.deleteAction(params.id);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Run standalone action ───────────────────────────────────────

    apiRouter.register("POST", "/api/flow-actions/:id/run", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, prompt, label } = body;
        if (typeof taskId !== "string" && typeof projectId !== "string") {
            return errorResponse("Either taskId or projectId must be a string", 400);
        }
        if (prompt !== undefined && typeof prompt !== "string") {
            return errorResponse('Field "prompt" must be a string', 400);
        }
        if (label !== undefined && typeof label !== "string") {
            return errorResponse('Field "label" must be a string', 400);
        }

        try {
            const actions = await flowStore.getActions();
            const action = actions.find((a) => a.id === params.id);
            if (!action) {
                return errorResponse(`Action not found: ${params.id}`, 404);
            }

            // Resolve projectId when running in task context
            let resolvedProjectId = typeof projectId === "string" ? projectId : undefined;
            if (typeof taskId === "string" && !resolvedProjectId) {
                const task = await taskStore.getTask(taskId);
                if (!task) {
                    return errorResponse(`Task not found: ${taskId}`, 404);
                }
                resolvedProjectId = task.projectId;
            }

            // Validate agent type availability (shell sessions don't need agent checks)
            if (
                action.sessionType !== "shell" &&
                !availableAgentTypes.has(action.sessionType as AgentType)
            ) {
                return errorResponse(
                    `Agent type "${action.sessionType}" required by action is not available`,
                    400,
                );
            }

            const owner =
                typeof taskId === "string" ? { taskId } : { projectId: projectId as string };
            const sessionId = await sessionLifecycle.createSession({
                owner,
                type: action.sessionType,
                prompt: typeof prompt === "string" ? prompt : action.prompt,
                label: typeof label === "string" ? label : action.name,
                agentOptions: action.agentOptions,
            });

            return jsonResponse({ sessionId, actionId: action.id }, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    // ── Flow execution ─────────────────────────────────────────────

    apiRouter.register("POST", "/api/flows/start", async (req) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { taskId, projectId, flowId, inputValues } = body;
        if (typeof flowId !== "string") {
            return errorResponse('Field "flowId" is required', 400);
        }
        if (typeof taskId !== "string" && typeof projectId !== "string") {
            return errorResponse("Either taskId or projectId must be a string", 400);
        }

        try {
            const flows = await flowStore.getFlows();
            const flow = flows.find((f) => f.id === flowId);
            if (!flow) return errorResponse(`Flow not found: ${flowId}`, 404);

            let validatedInputValues: Record<string, string> | undefined;
            if (inputValues !== undefined) {
                if (
                    typeof inputValues !== "object" ||
                    inputValues === null ||
                    Array.isArray(inputValues)
                ) {
                    return errorResponse(
                        "inputValues must be a plain object with string values",
                        400,
                    );
                }
                for (const [key, value] of Object.entries(inputValues as Record<string, unknown>)) {
                    if (typeof value !== "string") {
                        return errorResponse(`inputValues["${key}"] must be a string`, 400);
                    }
                }
                validatedInputValues = inputValues as Record<string, string>;
            }

            const owner =
                typeof taskId === "string" ? { taskId } : { projectId: projectId as string }; // safe: validated above
            const run = await flowRunner.startFlow(owner, flow, validatedInputValues);
            return jsonResponse(run, 201);
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/stop", async (_req, params) => {
        try {
            await flowRunner.stopFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/pause", async (_req, params) => {
        try {
            await flowRunner.pauseFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/resume", async (_req, params) => {
        try {
            await flowRunner.resumeFlow(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/skip", async (_req, params) => {
        try {
            await flowRunner.skipAction(params.ownerId, params.flowId);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("POST", "/api/flows/:ownerId/:flowId/jump", async (req, params) => {
        let body: Record<string, unknown>;
        try {
            body = (await req.json()) as Record<string, unknown>;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        const { actionIndex } = body;
        if (typeof actionIndex !== "number") {
            return errorResponse('Field "actionIndex" is required and must be a number', 400);
        }

        try {
            await flowRunner.jumpToAction(params.ownerId, params.flowId, actionIndex);
            return jsonResponse({ success: true });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            return errorResponse(message, 500);
        }
    });

    apiRouter.register("GET", "/api/flow-runs/:ownerId/:flowId", async (_req, params) => {
        const run = await flowStore.getFlowRun(params.ownerId, params.flowId);
        if (!run) return errorResponse("Flow run not found", 404);
        return jsonResponse(run);
    });

    apiRouter.register("GET", "/api/flow-runs/:ownerId", async (_req, params) => {
        const runs = await flowStore.getFlowRunsForOwner(params.ownerId);
        return jsonResponse({ runs });
    });
}

export { registerFlowRoutes };
export type { FlowRouteDeps };
