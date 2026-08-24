import { constants } from "os";
import { createCliRenderer, type CliRenderer, type CliRendererConfig } from "@opentui/core";

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

type OwnedRenderer = Pick<CliRenderer, "destroy" | "isDestroyed">;

interface ClosableSocket {
    close(): void;
}

interface StoppableBackend {
    stop(): void;
}

interface RuntimeOwnerOptions {
    createRenderer?: (config: CliRendererConfig) => Promise<OwnedRenderer>;
    env?: NodeJS.ProcessEnv;
    exit?: (code: number) => void;
    reportFatal?: (error: unknown) => void;
}

class OpenTuiRuntimeOwner {
    private readonly createRenderer: (config: CliRendererConfig) => Promise<OwnedRenderer>;
    private readonly env: NodeJS.ProcessEnv;
    private readonly exit: (code: number) => void;
    private readonly reportFatal: (error: unknown) => void;
    private renderer: OwnedRenderer | null = null;
    private socket: ClosableSocket | null = null;
    private backend: StoppableBackend | null = null;
    private shutdownPromise: Promise<void> | null = null;
    private destroyDone: Promise<void> = Promise.resolve();
    private resolveDestroy: (() => void) | null = null;
    private handlersInstalled = false;

    constructor(options: RuntimeOwnerOptions = {}) {
        this.createRenderer = options.createRenderer ?? createCliRenderer;
        this.env = options.env ?? process.env;
        this.exit = options.exit ?? ((code) => process.exit(code));
        this.reportFatal =
            options.reportFatal ??
            ((error) => {
                const message =
                    error instanceof Error ? error.stack || error.message : String(error);
                process.stderr.write(`${message}\n`);
            });
        this.installProcessHandlers();
    }

    ownSocket(socket: ClosableSocket): void {
        this.socket = socket;
    }

    ownBackend(backend: StoppableBackend): void {
        this.backend = backend;
    }

    async create(): Promise<CliRenderer> {
        let destroyed = false;
        this.destroyDone = new Promise<void>((resolve) => {
            this.resolveDestroy = () => {
                if (destroyed) return;
                destroyed = true;
                resolve();
            };
        });

        const renderer = await this.createRenderer({
            screenMode: "alternate-screen",
            exitOnCtrlC: false,
            exitSignals: [],
            useMouse: this.env.TASKFLOW_TUI_NO_MOUSE !== "1",
            enableMouseMovement: false,
            autoFocus: false,
            useKittyKeyboard: {
                disambiguate: true,
                alternateKeys: false,
                events: false,
                allKeysAsEscapes: false,
                reportText: false,
            },
            consoleMode: "disabled",
            openConsoleOnError: false,
            onDestroy: () => this.resolveDestroy?.(),
        });
        this.renderer = renderer;
        return renderer as CliRenderer;
    }

    private readonly onSignal = (signal: (typeof SIGNALS)[number]): void => {
        const code = 128 + constants.signals[signal];
        void this.shutdown().then(() => this.exit(code));
    };

    private readonly onUncaughtException = (error: unknown): void => {
        void this.shutdown().then(() => {
            this.reportFatal(error);
            this.exit(1);
        });
    };

    private readonly onUnhandledRejection = (error: unknown): void => {
        this.onUncaughtException(error);
    };

    private installProcessHandlers(): void {
        if (this.handlersInstalled) return;
        this.handlersInstalled = true;
        for (const signal of SIGNALS) process.on(signal, this.onSignal);
        process.on("uncaughtException", this.onUncaughtException);
        process.on("unhandledRejection", this.onUnhandledRejection);
    }

    private removeProcessHandlers(): void {
        if (!this.handlersInstalled) return;
        this.handlersInstalled = false;
        for (const signal of SIGNALS) process.off(signal, this.onSignal);
        process.off("uncaughtException", this.onUncaughtException);
        process.off("unhandledRejection", this.onUnhandledRejection);
    }

    shutdown(): Promise<void> {
        if (this.shutdownPromise !== null) return this.shutdownPromise;
        this.shutdownPromise = this.shutdownOnce();
        return this.shutdownPromise;
    }

    private async shutdownOnce(): Promise<void> {
        this.removeProcessHandlers();
        if (this.renderer !== null) {
            this.renderer.destroy();
            await this.destroyDone;
        }
        this.socket?.close();
        this.socket = null;
        this.backend?.stop();
        this.backend = null;
    }
}

export { OpenTuiRuntimeOwner };
export type { OwnedRenderer, RuntimeOwnerOptions };
