import type { ApiRouter } from "./router";
import type { TaskStore } from "../services/task-store";
import type { PtyManager } from "../services/pty-manager";
import type { SettingsStore } from "../services/settings-store";
import type { FlowStore } from "../services/flow-store";
import type { FlowRunner } from "../services/flow-runner";
import type { GitService } from "../services/git-service";
import type { ChangeTracker } from "../services/change-tracker";
import type { TrayStateTracker } from "../services/tray-state-tracker";
import type { NotificationStore } from "../services/notification-store";
import type { ScheduleStore } from "../services/schedule-store";
import type { RemoteAgentService } from "../services/remote-agent-service";
import type { SchedulerService } from "../services/scheduler-service";
import type {
    AgentAvailability,
    EditorInfo,
    RuntimeInfo,
    ShellInfo,
    WsEvent,
} from "@taskflow/shared";
import type { CreateSessionOpts } from "../services/session-lifecycle";
import { registerTaskRoutes } from "./routes/task-routes";
import { registerSessionRoutes } from "./routes/session-routes";
import { registerProjectRoutes } from "./routes/project-routes";
import { registerFlowRoutes } from "./routes/flow-routes";
import { registerScheduleRoutes } from "./routes/schedule-routes";
import { registerSettingsRoutes } from "./routes/settings-routes";
import { registerNotificationRoutes } from "./routes/notification-routes";
import { registerAttributeRoutes } from "./routes/attribute-routes";

interface ApiRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
    ptyManager: PtyManager;
    broadcast: (event: WsEvent) => void;
    settingsStore: SettingsStore;
    flowStore: FlowStore;
    flowRunner: FlowRunner;
    gitService: GitService;
    generateTitle?: (taskId: string, description: string, initCommand?: string) => void;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
    changeTracker?: ChangeTracker;
    agents: AgentAvailability[];
    sessionLifecycle: {
        createSession: (opts: CreateSessionOpts) => Promise<string>;
        removeSessionFromOwner: (
            sessionId: string,
            owner?: { taskId?: string; projectId?: string },
        ) => Promise<void>;
    };
    schedulerService: SchedulerService;
    trayStateTracker: TrayStateTracker;
    notificationStore: NotificationStore;
    scheduleStore: ScheduleStore;
    shells: ShellInfo[];
    systemShellPath: string | null;
    runtimes: RuntimeInfo[];
    editors: EditorInfo[];
    generateScheduleName: (prompt: string) => Promise<string>;
    remoteAgentService: RemoteAgentService;
}

function registerApiRoutes(deps: ApiRouteDeps): void {
    registerTaskRoutes(deps);
    registerAttributeRoutes(deps);
    registerSessionRoutes(deps);
    registerProjectRoutes(deps);
    registerFlowRoutes(deps);
    registerScheduleRoutes(deps);
    registerSettingsRoutes(deps);
    registerNotificationRoutes(deps);
}

export { registerApiRoutes };
export type { ApiRouteDeps };
