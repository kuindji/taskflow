import { describe, expect, it } from "bun:test";
import { parseYamlMapping } from "./validation";

describe("YAML validation", () => {
    it("parses one plain mapping", () => {
        expect(parseYamlMapping("name: Example\nenabled: false\n")).toEqual({
            name: "Example",
            enabled: false,
        });
    });

    it("rejects duplicate keys, aliases, and non-mapping documents", () => {
        expect(() => parseYamlMapping("name: one\nname: two\n")).toThrow();
        expect(() => parseYamlMapping("base: &base {name: one}\ncopy: *base\n")).toThrow(
            "aliases are not supported",
        );
        expect(() => parseYamlMapping("- one\n- two\n")).toThrow("must be a mapping");
    });
});
