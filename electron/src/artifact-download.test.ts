import { afterAll, afterEach, expect, test } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { downloadArtifact, isArtifactUrl } from "./artifact-download";

type Server = ReturnType<typeof Bun.serve>;

const servers: Server[] = [];
const dir = mkdtempSync(join(tmpdir(), "artifact-download-"));
let fileCount = 0;

function serve(fetch: () => Response): Server {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
    servers.push(server);
    return server;
}

/** A fresh path, alone in its own directory so a download's other files are visible. */
function destination(): string {
    fileCount += 1;
    const own = join(dir, `save-${fileCount}`);
    mkdirSync(own);
    return join(own, "artifact");
}

/** Files next to `target` other than `target` itself: a download still being written. */
function inProgressFiles(target: string): string[] {
    return readdirSync(dirname(target))
        .filter((name) => name !== basename(target))
        .map((name) => join(dirname(target), name));
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
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
    const target = destination();

    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];

    expect(isArtifactUrl(url, attachedNow)).toBe(true);
    const outcome = await downloadArtifact(url, () => attachedNow, target).then(
        () => readFileSync(target, "utf-8"),
        () => "refused",
    );
    expect(outcome).toBe("refused");
    expect(existsSync(target)).toBe(false);
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
    const outcome = await downloadArtifact(url, () => attachedNow, destination()).then(
        () => "saved",
        errorMessage,
    );

    expect(outcome).toBe("Invalid artifact URL");
    expect(hits).toBe(0);
});

test("the bytes are saved, and a refusal's body becomes the error without a file", async () => {
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

    const saved = destination();
    await downloadArtifact(urlOn(ok), attachedNow, saved);
    expect(readFileSync(saved, "utf-8")).toBe("REPORT");

    const refused = destination();
    const error = await downloadArtifact(urlOn(missing), attachedNow, refused).then(
        () => null,
        errorMessage,
    );
    expect(error).toBe("Artifact not found");
    expect(existsSync(refused)).toBe(false);
});

test("a destination name as long as the filesystem allows can be saved", async () => {
    const backend = serve(() => new Response("REPORT"));
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/report/raw`;
    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];
    const target = join(dirname(destination()), "a".repeat(250));

    await downloadArtifact(url, () => attachedNow, target);

    expect(readFileSync(target, "utf-8")).toBe("REPORT");
});

test("a large artifact is written as it arrives, not held whole in memory first", async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    const backend = serve(
        () =>
            new Response(
                new ReadableStream({
                    async start(controller) {
                        controller.enqueue(new TextEncoder().encode("PART-1"));
                        await released;
                        controller.enqueue(new TextEncoder().encode("PART-2"));
                        controller.close();
                    },
                }),
            ),
    );
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/recording/raw`;
    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];
    const target = destination();

    const download = downloadArtifact(url, () => attachedNow, target);
    const deadline = Date.now() + 2000;
    let early = "";
    while (Date.now() < deadline) {
        early = inProgressFiles(target)
            .map((file) => readFileSync(file, "utf-8"))
            .join("");
        if (early === "PART-1") break;
        await Bun.sleep(20);
    }
    release();
    await download;

    expect(early).toBe("PART-1");
    expect(readFileSync(target, "utf-8")).toBe("PART-1PART-2");
    expect(inProgressFiles(target)).toEqual([]);
});

/** A body that breaks off after its first chunk, once the response is already under way. */
function breakingBody(): Response {
    return new Response(
        new ReadableStream({
            async start(controller) {
                controller.enqueue(new TextEncoder().encode("PART-1"));
                await Bun.sleep(100);
                controller.error(new Error("connection lost"));
            },
        }),
    );
}

test("a failed download leaves the file the user chose to replace untouched", async () => {
    const backend = serve(breakingBody);
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/recording/raw`;
    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];
    const target = destination();
    writeFileSync(target, "USER-OLD");

    const outcome = await downloadArtifact(url, () => attachedNow, target).then(
        () => "saved",
        () => "failed",
    );

    expect(outcome).toBe("failed");
    expect(readFileSync(target, "utf-8")).toBe("USER-OLD");
    expect(inProgressFiles(target)).toEqual([]);
});

test("a body that breaks off mid-download leaves no partial file", async () => {
    const backend = serve(breakingBody);
    const url = `http://127.0.0.1:${backend.port}/api/flow/artifact/t/f/recording/raw`;
    const attachedNow = [{ id: "b", origin: `http://127.0.0.1:${backend.port}`, isLocal: false }];
    const target = destination();

    const outcome = await downloadArtifact(url, () => attachedNow, target).then(
        () => "saved",
        () => "failed",
    );

    expect(outcome).toBe("failed");
    expect(existsSync(target)).toBe(false);
    expect(inProgressFiles(target)).toEqual([]);
});
