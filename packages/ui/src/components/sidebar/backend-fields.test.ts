import { expect, test } from "bun:test";
import { parsePort } from "./backend-fields";

test("a port field takes decimal digits only", () => {
    expect(parsePort(" 2222 ")).toBe(2222);
    expect(parsePort("")).toBeUndefined();
    for (const typed of ["1e2", "0x16", "0b10110", "0o26", "2.5", "+22", "0", "65536", "ssh"]) {
        expect(parsePort(typed)).toBe("invalid");
    }
});
