import { expect, test } from "bun:test";
import { postBodyHeaders } from "./post-body-headers";

test("urlencoded body gives its content-type", () => {
    expect(postBodyHeaders({ contentType: "application/x-www-form-urlencoded" })).toBe(
        "content-type: application/x-www-form-urlencoded",
    );
});

test("multipart body appends the boundary", () => {
    expect(postBodyHeaders({ contentType: "multipart/form-data", boundary: "abc" })).toBe(
        "content-type: multipart/form-data; boundary=abc",
    );
});

test("no body gives undefined", () => {
    expect(postBodyHeaders(undefined)).toBeUndefined();
});
