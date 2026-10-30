import { describe, expect, test } from "bun:test";
import { isApiToken, parsePortHandshake } from "./api-token";

const TOKEN = "a".repeat(43);

describe("parsePortHandshake", () => {
    test("parses a port line and a token line", () => {
        expect(parsePortHandshake(`4321\n${TOKEN}`)).toEqual({ port: 4321, token: TOKEN });
    });

    test("accepts a trailing newline and no trailing newline", () => {
        for (const ending of ["", "\n"]) {
            expect(parsePortHandshake(`65535\n${TOKEN}${ending}`)).toEqual({
                port: 65535,
                token: TOKEN,
            });
        }
    });

    test("returns null for an empty file, a port alone, and a port with a half-written token", () => {
        for (const content of ["", "4321", "4321\n", `4321\n${TOKEN.slice(0, 20)}`]) {
            expect(parsePortHandshake(content)).toBeNull();
        }
    });

    test("returns null for a non-numeric, zero or out-of-range port", () => {
        for (const port of ["43x", "0", "65536", "-1", "1.5", " 4321", "4321 "]) {
            expect(parsePortHandshake(`${port}\n${TOKEN}\n`)).toBeNull();
        }
    });

    test("returns null when a third non-empty line follows", () => {
        expect(parsePortHandshake(`4321\n${TOKEN}\nextra`)).toBeNull();
    });
});

test("isApiToken accepts 43 base64url characters and rejects 42, 44, padding and other characters", () => {
    expect(isApiToken("Ab0_-" + "z".repeat(38))).toBe(true);
    for (const value of [
        "a".repeat(42),
        "a".repeat(44),
        "a".repeat(42) + "=",
        "a".repeat(42) + "+",
        "a".repeat(42) + "/",
        null,
        43,
    ]) {
        expect(isApiToken(value)).toBe(false);
    }
});
