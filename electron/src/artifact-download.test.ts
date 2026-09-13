import { afterEach, expect, test } from "bun:test";
import { fetchArtifactBytes, isArtifactUrl } from "./artifact-download";

type Server = ReturnType<typeof Bun.serve>;

const servers: Server[] = [];

function serve(fetch: () => Response): Server {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
    servers.push(server);
    return server;
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

const attached = [{ id: "desktop.local:main", origin: "http://127.0.0.1:4102", isLocal: false }];

test("only a raw-artifact route on an attached origin is accepted", () => {
    expect(isArtifactUrl("http://127.0.0.1:4102/api/flow/artifact/t/f/report/raw", attached)).toBe(
        true,
    );
    expect(isArtifactUrl("http://127.0.0.1:4103/api/flow/artifact/t/f/report/raw", attached)).toBe(
        false,
    );
    expect(isArtifactUrl("http://127.0.0.1:4102/api/file/raw?path=/etc/hosts", attached)).toBe(
        false,
    );
    expect(isArtifactUrl("http://127.0.0.1:4102/api/flow/artifact/../../file/raw", attached)).toBe(
        false,
    );
    expect(isArtifactUrl("not a url", attached)).toBe(false);
});

test("an attached backend redirecting elsewhere does not get the other origin fetched", async () => {
    const elsewhere = serve(() => new Response("CLIENT-LOCAL"));
    const backend = serve(() => Response.redirect(`http://127.0.0.1:${elsewhere.port}/admin`, 302));
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/report/raw`;

    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];

    expect(isArtifactUrl(url, attachedNow)).toBe(true);
    const outcome = await fetchArtifactBytes(url, () => attachedNow).then(
        (bytes) => bytes.toString(),
        () => "refused",
    );
    expect(outcome).toBe("refused");
});

test("a machine detached while the save dialog was open does not get its origin fetched", async () => {
    let hits = 0;
    const backend = serve(() => {
        hits += 1;
        return new Response("REPORT");
    });
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/report/raw`;
    let attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];

    expect(isArtifactUrl(url, attachedNow)).toBe(true);
    attachedNow = [];
    const outcome = await fetchArtifactBytes(url, () => attachedNow).then(
        (bytes) => bytes.toString(),
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

    expect(outcome).toBe("Invalid artifact URL");
    expect(hits).toBe(0);
});

test("the bytes come back, and a refusal's body becomes the error", async () => {
    const ok = serve(() => new Response("REPORT"));
    const missing = serve(() => new Response("Artifact not found", { status: 404 }));
    const urlOn = (server: Server) =>
        `http://127.0.0.1:${server.port}/api/flow/artifact/t/f/report/raw`;
    const attachedNow = () =>
        [ok, missing].map((server) => ({
            id: String(server.port),
            origin: `http://127.0.0.1:${server.port}`,
            isLocal: false,
        }));

    expect((await fetchArtifactBytes(urlOn(ok), attachedNow)).toString()).toBe("REPORT");
    const error = await fetchArtifactBytes(urlOn(missing), attachedNow).then(
        () => null,
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );
    expect(error).toBe("Artifact not found");
});
