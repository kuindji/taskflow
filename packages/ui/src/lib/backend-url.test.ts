import { afterEach, expect, test } from "bun:test";
import { rawFileUrl } from "./backend-url";
import { closeConnection, openConnection } from "./connection-registry";
import { startTestServer, type TestServer } from "./test-ws-server";

const servers: TestServer[] = [];
afterEach(() => {
    closeConnection("a", "detach");
    servers.splice(0).forEach((server) => server.stop());
});

test("rawFileUrl carries the backend's token as a query parameter", async () => {
    const server = startTestServer("A");
    servers.push(server);
    await openConnection("a", server.origin, "token%value");
    expect(rawFileUrl("a", "/tmp/a b.png")).toBe(
        `${server.origin}/api/file/raw?path=%2Ftmp%2Fa%20b.png&token=token%25value`,
    );
});

test("rawFileUrl has no token parameter when the connection has none", async () => {
    const server = startTestServer("A");
    servers.push(server);
    await openConnection("a", server.origin);
    expect(rawFileUrl("a", "/tmp/a.png")).toBe(`${server.origin}/api/file/raw?path=%2Ftmp%2Fa.png`);
});

test("rawFileUrl is null for a backend that is not attached", () => {
    expect(rawFileUrl("missing", "/tmp/a.png")).toBeNull();
});
