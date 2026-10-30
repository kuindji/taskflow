import { BrowserHostUnavailableError } from "./browser-tab-errors";

interface BrowserHostClient {
    ensure(
        controlUrl: string,
        req: { tabId: string; url: string; parentId?: string },
    ): Promise<{ targetId: string }>;
    close(controlUrl: string, tabId: string): Promise<void>;
}

function createBrowserHostClient(): BrowserHostClient {
    async function post(controlUrl: string, path: string, body: unknown): Promise<Response> {
        try {
            const response = await fetch(new URL(path, controlUrl), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) throw new BrowserHostUnavailableError();
            return response;
        } catch {
            throw new BrowserHostUnavailableError();
        }
    }

    return {
        async ensure(controlUrl, req) {
            try {
                const response = await post(controlUrl, "/tabs/ensure", req);
                const result: unknown = await response.json();
                if (
                    typeof result !== "object" ||
                    result === null ||
                    !("targetId" in result) ||
                    typeof result.targetId !== "string"
                ) {
                    throw new BrowserHostUnavailableError();
                }
                return { targetId: result.targetId };
            } catch {
                throw new BrowserHostUnavailableError();
            }
        },
        async close(controlUrl, tabId) {
            const response = await post(controlUrl, "/tabs/close", { tabId });
            await response.body?.cancel();
        },
    };
}

export { createBrowserHostClient };
export type { BrowserHostClient };
