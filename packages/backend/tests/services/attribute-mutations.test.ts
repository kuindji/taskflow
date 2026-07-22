import { describe, expect, it } from "bun:test";
import {
    addAttribute,
    editAttribute,
    removeAttribute,
} from "../../src/services/attribute-mutations";
import type { Attribute } from "@taskflow/shared";

const base: Attribute[] = [
    { id: "a", name: "env", value: "prod" },
    { id: "b", name: "ticket", value: "T-1" },
];

describe("addAttribute", () => {
    it("appends a new attribute without mutating the input", () => {
        const next = addAttribute(base, "c", "region", "eu");
        expect(next).toHaveLength(3);
        expect(next[2]).toEqual({ id: "c", name: "region", value: "eu" });
        expect(base).toHaveLength(2);
    });

    it("trims the name", () => {
        const next = addAttribute(base, "c", "  region  ", "eu");
        expect(next[2].name).toBe("region");
    });

    it("rejects an empty name", () => {
        expect(() => addAttribute(base, "c", "   ", "eu")).toThrow(
            "Attribute name cannot be empty",
        );
    });

    it("rejects a duplicate name", () => {
        expect(() => addAttribute(base, "c", "env", "dev")).toThrow(
            'Attribute name already exists: "env"',
        );
    });
});

describe("editAttribute", () => {
    it("changes the value", () => {
        const next = editAttribute(base, "a", { value: "staging" });
        expect(next[0]).toEqual({ id: "a", name: "env", value: "staging" });
    });

    it("changes the name", () => {
        const next = editAttribute(base, "a", { name: "environment" });
        expect(next[0].name).toBe("environment");
    });

    it("allows renaming an attribute to its own current name", () => {
        const next = editAttribute(base, "a", { name: "env" });
        expect(next[0].name).toBe("env");
    });

    it("rejects renaming onto a sibling's name", () => {
        expect(() => editAttribute(base, "a", { name: "ticket" })).toThrow(
            'Attribute name already exists: "ticket"',
        );
    });

    it("rejects an unknown id", () => {
        expect(() => editAttribute(base, "zzz", { value: "x" })).toThrow(
            "Attribute not found: zzz",
        );
    });

    it("preserves position", () => {
        const next = editAttribute(base, "a", { value: "staging" });
        expect(next.map((a) => a.id)).toEqual(["a", "b"]);
    });
});

describe("removeAttribute", () => {
    it("removes by id", () => {
        const next = removeAttribute(base, "a");
        expect(next.map((a) => a.id)).toEqual(["b"]);
    });

    it("rejects an unknown id", () => {
        expect(() => removeAttribute(base, "zzz")).toThrow("Attribute not found: zzz");
    });
});
