import { describe, expect, it } from "bun:test";
import type { SessionSnapshotResponse } from "@taskflow/shared";
import { assertCompatibleSnapshot, supplementalSnapshotSequence } from "./snapshot-state";

describe("snapshot compatibility state", () => {
    it("rejects an old backend only when it returns a non-null snapshot", () => {
        const oldSnapshot = {
            snapshot: "screen",
            lastSequence: 4,
            cursorHidden: false,
            kittyStack: [],
        };
        expect(() => assertCompatibleSnapshot(oldSnapshot)).toThrow("missing mouseEncoding");
        expect(() => assertCompatibleSnapshot({ ...oldSnapshot, snapshot: null })).not.toThrow();
    });

    it("restores mouse encoding, nested kitty state, and cursor visibility in order", () => {
        const snapshot: SessionSnapshotResponse = {
            snapshot: "screen",
            lastSequence: 4,
            cursorHidden: true,
            kittyStack: [null, 1, 5],
            mouseEncoding: "sgr",
        };
        expect(supplementalSnapshotSequence(snapshot)).toBe("\x1b[?1006h\x1b[>1u\x1b[>5u\x1b[?25l");
    });

    it("does not push a fresh terminal's null kitty base", () => {
        const snapshot: SessionSnapshotResponse = {
            snapshot: "screen",
            lastSequence: 0,
            cursorHidden: false,
            kittyStack: [null, 1],
            mouseEncoding: "x10",
        };
        expect(supplementalSnapshotSequence(snapshot)).toBe("\x1b[>1u");
    });
});
