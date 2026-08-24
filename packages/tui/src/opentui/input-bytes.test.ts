import { describe, expect, it } from "bun:test";
import { inputBytesToString } from "./input-bytes";

describe("inputBytesToString", () => {
    it("preserves ASCII controls and Unicode", () => {
        expect(inputBytesToString(new Uint8Array([0x1b, 0x5b, 0x41]))).toBe("\x1b[A");
        expect(inputBytesToString(new TextEncoder().encode("猫🙂"))).toBe("猫🙂");
    });

    it("drops empty and non-round-trippable byte sequences", () => {
        expect(inputBytesToString(new Uint8Array())).toBeNull();
        expect(inputBytesToString(new Uint8Array([0x80]))).toBeNull();
        expect(inputBytesToString(new Uint8Array([0xc0, 0xaf]))).toBeNull();
    });

    it("preserves the settled X10 coordinate boundary", () => {
        expect(inputBytesToString(new Uint8Array([0x1b, 0x5b, 0x4d, 32, 127, 33]))).not.toBeNull();
        expect(inputBytesToString(new Uint8Array([0x1b, 0x5b, 0x4d, 32, 128, 33]))).toBeNull();
    });
});
