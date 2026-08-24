import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { resolveDevLaunchConfig, sanitizeBranch } from "./dev";

const base = {
    env: {},
    platform: "darwin" as const,
    homeDir: "/Users/test",
    repoRoot: "/work/taskflow",
    branch: "feature/live sessions",
};

describe("TUI development launcher", () => {
    it("the root launcher starts the interactive process directly", () => {
        const rootPackage = JSON.parse(
            readFileSync(resolve(import.meta.dir, "../../../package.json"), "utf-8"),
        ) as { scripts?: Record<string, string> };
        expect(rootPackage.scripts?.["dev:tui"]).toBe(
            "bun run build:backend:bin && bun packages/tui/src/dev.ts",
        );
    });

    it("sanitizes the Git branch and selects a persistent sibling config root", () => {
        expect(sanitizeBranch(" feature/live sessions ")).toBe("feature-live-sessions");
        expect(resolveDevLaunchConfig(base)).toEqual({
            devBranch: "feature-live-sessions",
            instanceId: "dev-feature-live-sessions",
            configDir: "/Users/test/.config/taskflow-tui-dev/feature-live-sessions",
            backendBin: "/work/taskflow/packages/backend/dist/taskflow-backend",
        });
    });

    it("keeps an explicit branch and absolute config root", () => {
        const launch = resolveDevLaunchConfig({
            ...base,
            env: {
                TASKFLOW_DEV_BRANCH: "manual-branch",
                TASKFLOW_CONFIG_DIR: "/tmp/taskflow-parallel",
                TASKFLOW_BACKEND_BIN: "/tmp/backend",
            },
        });
        expect(launch).toEqual({
            devBranch: "manual-branch",
            instanceId: "dev-manual-branch",
            configDir: "/tmp/taskflow-parallel",
            backendBin: "/tmp/backend",
        });
    });

    it("rejects a relative config root before launch", () => {
        expect(() =>
            resolveDevLaunchConfig({
                ...base,
                env: { TASKFLOW_CONFIG_DIR: "tmp/taskflow" },
            }),
        ).toThrow("TASKFLOW_CONFIG_DIR must be an absolute path");
    });

    it("does not place its default root inside the production root", () => {
        const configDir = resolveDevLaunchConfig(base).configDir;
        const productionRoot = join(base.homeDir, ".config", "taskflow");
        expect(configDir.startsWith(`${productionRoot}/`)).toBe(false);
        expect(configDir).not.toBe(productionRoot);
    });

    it("never resolves the development instance to main", () => {
        expect(resolveDevLaunchConfig({ ...base, branch: "main" }).instanceId).toBe("dev-main");
    });
});
