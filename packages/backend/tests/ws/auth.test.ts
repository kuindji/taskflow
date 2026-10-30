import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import {
    cdpKey,
    checkRequest,
    isUpgradeRequest,
    parseUiOrigins,
    upgradeHeaders,
} from "../../src/ws/auth";

const T = "A".repeat(43);
const ctx = { token: T, allowedOrigins: parseUiOrigins("http://localhost:5173") };

function request(
    path = "/api/settings",
    headers: Record<string, string> = {},
    method = "GET",
): Request {
    return new Request(`http://127.0.0.1:4321${path}`, {
        method,
        headers: { Host: "127.0.0.1:4321", ...headers },
    });
}
function check(req: Request) {
    return checkRequest(req, new URL(req.url), ctx);
}
const credential = { Authorization: `Bearer ${T}` };
const upgrade = { Upgrade: "websocket" };

test('cdpKey is the base64url HMAC-SHA256 of "cdp:<tabId>" keyed by the token', () => {
    const expected = createHmac("sha256", T).update("cdp:tab-1").digest("base64url");
    expect(cdpKey(T, "tab-1")).toBe(expected);
    expect(cdpKey(T, "tab-1")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

describe("checkRequest", () => {
    test("a /cdp/<id>/<key>/json/version request with the right key passes", () => {
        expect(check(request(`/cdp/tab-1/${cdpKey(T, "tab-1")}/json/version`))).toEqual({
            ok: true,
        });
    });
    test("a key for another tab id fails", () => {
        expect(check(request(`/cdp/tab-1/${cdpKey(T, "tab-2")}/json/version`))).toEqual({
            ok: false,
            reason: "credential",
        });
    });
    test("a /cdp/<id>/json/version request without a key segment fails", () => {
        for (const path of ["/cdp/tab-1", "/cdp/tab-1/json/version"]) {
            expect(check(request(path))).toEqual({ ok: false, reason: "credential" });
        }
    });
    test("a /cdp/ upgrade with the right key passes", () => {
        expect(
            check(request(`/cdp/tab-1/${cdpKey(T, "tab-1")}/devtools/browser`, upgrade)),
        ).toEqual({ ok: true });
    });

    test("Host 127.0.0.1, localhost and [::1] on any port pass the host check", () => {
        for (const Host of ["127.0.0.1", "localhost:1", "127.0.0.1:65535", "[::1]:4321"]) {
            expect(check(request("/api/settings", { Host, ...credential }))).toEqual({ ok: true });
        }
    });
    test("Host evil.example and 127.0.0.2 fail with reason host", () => {
        for (const Host of ["evil.example", "127.0.0.2:4321", "[invalid"]) {
            expect(check(request("/", { Host, ...credential }))).toEqual({
                ok: false,
                reason: "host",
            });
        }
    });
    test("a missing Host fails with reason host", () => {
        expect(check(new Request("http://127.0.0.1/"))).toEqual({ ok: false, reason: "host" });
    });
    test("no Origin skips the origin check", () => {
        expect(check(request("/api/settings", credential))).toEqual({ ok: true });
    });
    test("Origin file://, null and an allowlisted dev origin pass", () => {
        for (const Origin of ["file://", "null", "http://localhost:5173"]) {
            expect(check(request("/api/settings", { Origin, ...credential }))).toEqual({
                ok: true,
            });
        }
    });
    test("Origin https://evil.example fails with reason origin, before the credential is looked at", () => {
        expect(check(request("/", { Origin: "https://evil.example" }))).toEqual({
            ok: false,
            reason: "origin",
        });
    });
    test("parseUiOrigins trims, normalises a trailing slash, and skips unparsable entries", () => {
        expect(
            parseUiOrigins(
                " http://localhost:5173/ , nonsense,https://example.com/a, data:text/plain,abc",
            ),
        ).toEqual(new Set(["file://", "null", "http://localhost:5173", "https://example.com"]));
        expect(parseUiOrigins(undefined)).toEqual(new Set(["file://", "null"]));
    });
    test("GET / without upgrade headers passes with no credential", () => {
        expect(check(request("/"))).toEqual({ ok: true });
    });
    test("an upgrade to / without a credential fails with reason credential", () => {
        expect(check(request("/", upgrade))).toEqual({ ok: false, reason: "credential" });
        expect(isUpgradeRequest(request("/", { Upgrade: "WebSocket" }))).toBe(true);
        expect(isUpgradeRequest(request("/"))).toBe(false);
    });
    test("a Bearer header with the token passes on HTTP and on an upgrade", () => {
        for (const headers of [
            credential,
            { ...credential, ...upgrade },
            { Authorization: `bEaReR ${T}` },
        ]) {
            expect(check(request("/api/settings", headers))).toEqual({ ok: true });
        }
    });
    test("a Bearer header with another token of the same length fails", () => {
        expect(
            check(request("/api/settings", { Authorization: `Bearer ${"B".repeat(43)}` })),
        ).toEqual({ ok: false, reason: "credential" });
    });
    test("a token of a different length fails without throwing", () => {
        expect(check(request("/api/settings", { Authorization: "Bearer short" }))).toEqual({
            ok: false,
            reason: "credential",
        });
    });
    test("the taskflow.auth.<token> subprotocol passes an upgrade", () => {
        expect(
            check(
                request("/", {
                    ...upgrade,
                    "Sec-WebSocket-Protocol": `taskflow, taskflow.auth.wrong, taskflow.auth.${T}`,
                }),
            ),
        ).toEqual({ ok: true });
    });
    test("the subprotocol credential is ignored on a plain HTTP request", () => {
        expect(
            check(
                request("/api/settings", {
                    "Sec-WebSocket-Protocol": `taskflow, taskflow.auth.${T}`,
                }),
            ),
        ).toEqual({ ok: false, reason: "credential" });
    });
    test("token query passes GET /api/file/raw and GET /api/flow/artifact/o/f/t/raw", () => {
        for (const path of ["/api/file/raw", "/api/flow/artifact/o/f/t/raw"]) {
            expect(check(request(`${path}?token=${T}`))).toEqual({ ok: true });
        }
    });
    test("token query fails POST /api/file/raw, GET /api/settings and GET /api/flow/artifact/o/f/t", () => {
        for (const [method, path] of [
            ["POST", "/api/file/raw"],
            ["GET", "/api/settings"],
            ["GET", "/api/flow/artifact/o/f/t"],
        ]) {
            expect(check(request(`${path}?token=${T}`, {}, method))).toEqual({
                ok: false,
                reason: "credential",
            });
        }
    });
    test("upgradeHeaders answers taskflow only when taskflow was offered, in either order with the auth entry, and nothing for an auth-only offer", () => {
        for (const protocols of [`taskflow, taskflow.auth.${T}`, `taskflow.auth.${T}, taskflow`]) {
            expect(
                upgradeHeaders(request("/", { ...upgrade, "Sec-WebSocket-Protocol": protocols })),
            ).toEqual({ "Sec-WebSocket-Protocol": "taskflow" });
        }
        expect(
            upgradeHeaders(
                request("/", { ...upgrade, "Sec-WebSocket-Protocol": `taskflow.auth.${T}` }),
            ),
        ).toBeUndefined();
        expect(upgradeHeaders(request("/"))).toBeUndefined();
    });
    test("an auth-only subprotocol offer is not a credential", () => {
        expect(
            check(request("/", { ...upgrade, "Sec-WebSocket-Protocol": `taskflow.auth.${T}` })),
        ).toEqual({ ok: false, reason: "credential" });
    });
});
