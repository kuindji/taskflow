import { Router, type ClientContext } from "../src/ws/router";

/** Handler tests drive the router without a WebSocket connection; this stands in for one client. */
const TEST_CLIENT: ClientContext = { clientId: "test" };

/** A `Router` whose `handle` defaults the client context, so handler tests read as before. */
export class TestRouter extends Router {
    override handle(
        type: string,
        payload: unknown,
        ctx: ClientContext = TEST_CLIENT,
    ): Promise<unknown> {
        return super.handle(type, payload, ctx);
    }
}
