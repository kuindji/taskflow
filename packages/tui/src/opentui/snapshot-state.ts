import type { MouseEncoding, SessionSnapshotResponse } from "@taskflow/shared";

const MOUSE_ENCODING_SEQUENCE: Readonly<Record<MouseEncoding, string>> = {
    x10: "",
    utf8: "\x1b[?1005h",
    sgr: "\x1b[?1006h",
    urxvt: "\x1b[?1015h",
    "sgr-pixels": "\x1b[?1016h",
};

const MOUSE_ENCODINGS = new Set<MouseEncoding>(["x10", "utf8", "sgr", "urxvt", "sgr-pixels"]);

function hasMouseEncoding(
    snapshot: SessionSnapshotResponse | Record<string, unknown>,
): snapshot is SessionSnapshotResponse {
    return MOUSE_ENCODINGS.has(snapshot.mouseEncoding as MouseEncoding);
}

function assertCompatibleSnapshot(
    snapshot: SessionSnapshotResponse | Record<string, unknown>,
): asserts snapshot is SessionSnapshotResponse {
    if (snapshot.snapshot !== null && !hasMouseEncoding(snapshot)) {
        throw new Error(
            "The Taskflow backend snapshot is missing mouseEncoding. Upgrade the remote backend to this Taskflow version.",
        );
    }
}

function supplementalSnapshotSequence(snapshot: SessionSnapshotResponse): string {
    let sequence = MOUSE_ENCODING_SEQUENCE[snapshot.mouseEncoding];
    const kitty =
        snapshot.kittyStack[0] === null ? snapshot.kittyStack.slice(1) : snapshot.kittyStack;
    for (const flags of kitty) {
        if (flags !== null) sequence += `\x1b[>${String(flags)}u`;
    }
    if (snapshot.cursorHidden) sequence += "\x1b[?25l";
    return sequence;
}

export { assertCompatibleSnapshot, supplementalSnapshotSequence };
