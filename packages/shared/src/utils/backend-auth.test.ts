import { expect, test } from "bun:test";
import {
    BackendUnauthorizedError,
    createTokenRefreshGate,
    unauthorizedFailure,
} from "./backend-auth";

test("the gate refreshes once per id, then rejects until authenticated", () => {
    const gate = createTokenRefreshGate();
    expect(gate.unauthorized("a")).toBe("refresh");
    expect(gate.unauthorized("a")).toBe("reject");
    expect(gate.unauthorized("a")).toBe("reject");
    gate.authenticated("a");
    expect(gate.unauthorized("a")).toBe("refresh");
});
test("ids are independent", () => {
    const gate = createTokenRefreshGate();
    expect(gate.unauthorized("a")).toBe("refresh");
    expect(gate.unauthorized("b")).toBe("refresh");
    gate.authenticated("b");
    expect(gate.unauthorized("a")).toBe("reject");
});
test("unauthorizedFailure has kind unauthorized and the exact remote and local messages", () => {
    expect(unauthorizedFailure(false)).toEqual({
        kind: "unauthorized",
        message: "Remote backend rejected the access token",
        stderr: "",
    });
    expect(unauthorizedFailure(true)).toEqual({
        kind: "unauthorized",
        message: "The local backend rejected the access token",
        stderr: "",
    });
    const error = new BackendUnauthorizedError();
    expect(error.message).toBe("Unauthorized");
    expect(error.name).toBe("BackendUnauthorizedError");
});
