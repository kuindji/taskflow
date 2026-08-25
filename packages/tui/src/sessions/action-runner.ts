import { MSG } from "@taskflow/shared";
import type { ActionDefinition, ShellListResponse } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { ownerRequest, type SessionOwner } from "./owner";

interface ActionSessionController {
    create(
        owner: SessionOwner,
        payload: Parameters<import("./controller").SessionController["create"]>[1],
    ): Promise<string>;
}

class ActionRunner {
    constructor(
        private readonly net: NetLike,
        private readonly controller: ActionSessionController,
    ) {}

    async run(owner: SessionOwner, action: ActionDefinition): Promise<string> {
        if (!action.standalone) throw new Error("Only standalone actions can be run directly");
        if (action.sessionType !== "shell") {
            return this.controller.create(owner, {
                ...ownerRequest(owner),
                type: action.sessionType,
                label: action.name,
                prompt: action.prompt,
                agentOptions: action.agentOptions,
            });
        }

        const shells = await this.net.request<ShellListResponse>(MSG.SHELLS_LIST);
        const shell =
            shells.shells.find((candidate) => candidate.path === shells.systemShellPath) ??
            shells.shells[0];
        if (!shell) throw new Error("No shell is available");
        const sessionId = await this.controller.create(owner, {
            ...ownerRequest(owner),
            type: "shell",
            label: action.name,
            shell: shell.path,
        });
        await this.net.request(MSG.SESSION_INPUT, {
            sessionId,
            data: `${action.prompt}\r`,
        });
        return sessionId;
    }
}

export { ActionRunner };
export type { ActionSessionController };
