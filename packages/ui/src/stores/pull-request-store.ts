import { create } from "zustand";
import type { GitCheckPrResult } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

export function pullRequestKey(backendId: string, repoPath: string, branch: string): string {
    return JSON.stringify([backendId, repoPath, branch]);
}
interface PullRequestStore {
    byKey: Record<string, GitCheckPrResult>;
    check(backendId: string, repoPath: string, branch: string): Promise<GitCheckPrResult>;
}
const pending = new Map<
    string,
    { backendId: string; generation: symbol; promise: Promise<GitCheckPrResult> }
>();
export const usePullRequestStore = create<PullRequestStore>((set, get) => ({
    byKey: {},
    check: (backendId, repoPath, branch) => {
        const key = pullRequestKey(backendId, repoPath, branch);
        const current = pending.get(key);
        if (current) return current.promise;
        const generation = Symbol();
        const promise: Promise<GitCheckPrResult> = (async () => {
            let result: GitCheckPrResult;
            try {
                result = await sendRequest<GitCheckPrResult>(backendId, MSG.GIT_CHECK_PR, {
                    path: repoPath,
                    branch,
                });
            } catch {
                const provider = get().byKey[key]?.provider ?? null;
                result = {
                    status: "unavailable",
                    provider,
                    pr: null,
                    reason: "failed",
                    message:
                        provider === "gitlab"
                            ? "Merge request status is unavailable"
                            : "Pull request status is unavailable",
                };
            }
            if (pending.get(key)?.generation === generation) {
                set((state) => ({ byKey: { ...state.byKey, [key]: result } }));
                pending.delete(key);
            }
            return result;
        })();
        pending.set(key, { backendId, generation, promise });
        return promise;
    },
}));
registerBackendReset("pull-request-store", (backendId) => {
    for (const [key, entry] of pending) if (entry.backendId === backendId) pending.delete(key);
    usePullRequestStore.setState((state) => ({
        byKey: Object.fromEntries(
            Object.entries(state.byKey).filter(
                ([key]) => (JSON.parse(key) as string[])[0] !== backendId,
            ),
        ),
    }));
});
