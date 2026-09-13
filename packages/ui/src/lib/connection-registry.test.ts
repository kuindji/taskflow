import { afterEach, describe, expect, test } from "bun:test";
import {
    BackendDetachedError,
    closeConnection,
    onEvent,
    onPrimaryChange,
    onStatusChange,
    openConnection,
    rekeyConnection,
    sendRequest,
    setPrimary,
} from "./connection-registry";
import { startTestServer as startServer } from "./test-ws-server";

const servers: { stop(): void }[] = [];
afterEach(() => {
    closeConnection("a", "detach");
    closeConnection("b", "detach");
    servers.splice(0).forEach((s) => s.stop());
});

describe("connection registry", () => {
    test("routes a request to the named backend and nowhere else", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);
        setPrimary("a");

        expect(await sendRequest<{ from: string }>("a", "ping")).toEqual({ from: "A" });
        expect(await sendRequest<{ from: string }>("b", "ping")).toEqual({ from: "B" });
    });

    test("an event handler learns which backend delivered it", async () => {
        const a = startServer("A");
        const b = startServer("B");
        servers.push(a, b);

        await openConnection("a", a.origin);
        await openConnection("b", b.origin);

        const seen: string[] = [];
        const off = onEvent("thing", (_payload, backendId) => seen.push(backendId));
        b.broadcast("thing");
        await new Promise((resolve) => setTimeout(resolve, 200));
        off();

        expect(seen).toEqual(["b"]);
    });

    test("closing one backend rejects only its pending requests", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        // A request that will never be answered, because we close first.
        const pending = sendRequest("a", "never");
        closeConnection("a", "detach");

        const error = await pending.then(
            () => null,
            (reason: unknown) => reason,
        );
        expect(error).toBeInstanceOf(BackendDetachedError);
    });

    test("primary changes are observable, including through a rekey", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        const seen: (string | null)[] = [];
        const off = onPrimaryChange((id) => seen.push(id));
        setPrimary("a");
        rekeyConnection("a", "a-uid");
        off();
        closeConnection("a-uid", "detach");

        expect(seen).toEqual(["a", "a-uid"]);
    });

    test("closing a connection that is still opening rejects the open", async () => {
        const a = startServer("A");
        servers.push(a);

        const opening = openConnection("a", a.origin);
        closeConnection("a", "detach");

        const outcome = await Promise.race([
            opening.then(
                () => "resolved",
                (reason: unknown) => reason,
            ),
            new Promise((resolve) => setTimeout(() => resolve("still pending"), 1000)),
        ]);
        expect(outcome).toBeInstanceOf(BackendDetachedError);
    });

    test("a rekey keeps the status subscribers already waiting under the new id", async () => {
        const a = startServer("A");
        servers.push(a);

        const seen: boolean[] = [];
        const off = onStatusChange("a-uid", (status) => seen.push(status.connected));
        await openConnection("a", a.origin);
        const offProvisional = onStatusChange("a", () => {});
        rekeyConnection("a", "a-uid");
        closeConnection("a-uid", "detach");
        off();
        offProvisional();

        // The initial "not connected", the rekeyed connection's live status,
        // then its close.
        expect(seen).toEqual([false, true, false]);
    });

    test("unsubscribing after a rekey stops the status updates", async () => {
        const a = startServer("A");
        servers.push(a);
        await openConnection("a", a.origin);

        const seen: boolean[] = [];
        const off = onStatusChange("a", (status) => seen.push(status.connected));
        rekeyConnection("a", "a-uid");
        off();
        closeConnection("a-uid", "detach");

        // Only the status replayed on subscribe.
        expect(seen).toEqual([true]);
    });
});
