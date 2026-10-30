import { expect, test } from "bun:test";
import { parseDevToolsActivePort } from "./debug-port";

test("parses the first line as the port", () => {
    expect(parseDevToolsActivePort("49231\n/devtools/browser/id\n")).toBe(49231);
});

test("returns null for empty or non-numeric content", () => {
    for (const content of ["", "\n/path", "nope\n/path", "12nope", "0", "65536"]) {
        expect(parseDevToolsActivePort(content)).toBeNull();
    }
});
