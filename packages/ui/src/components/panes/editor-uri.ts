import * as monaco from "monaco-editor";
import { registerBackendReset } from "@/stores/store-reset";

/**
 * Monaco's model registry is global and keyed by URI, so a file's identity must
 * include the machine it lives on. Without the authority, the same absolute
 * path on two machines resolves to one model with one buffer and one undo
 * stack, and saving writes the other machine's unsaved text to this machine's
 * file.
 *
 * The path is carried in the fragment rather than the URI path so that no part
 * of it is reinterpreted as URI structure — a Windows drive letter, a `#`, or a
 * `?` in a filename all survive unchanged.
 *
 * The backend id is hex-encoded into the authority: `Uri.toString()` lowercases
 * an authority and reads anything after its last `:` as a port, so a raw id
 * would fold two ids that differ in case into one model.
 */
const SCHEME = "taskflow-file";

const HEX_ID = /^(?:[0-9a-f]{2})+$/;

function encodeId(backendId: string): string {
    return Array.from(new TextEncoder().encode(backendId), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}

function decodeId(authority: string): string | null {
    if (!HEX_ID.test(authority)) return null;
    const bytes = new Uint8Array(authority.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(authority.slice(i * 2, i * 2 + 2), 16);
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

export function modelUriFor(backendId: string, absolutePath: string): monaco.Uri {
    return monaco.Uri.from({
        scheme: SCHEME,
        authority: encodeId(backendId),
        path: "/",
        fragment: absolutePath,
    });
}

export function pathFromModelUri(uri: monaco.Uri): string {
    return uri.fragment;
}

/** The machine a model belongs to, or null for a URI this module did not build. */
export function backendFromModelUri(uri: monaco.Uri): string | null {
    if (uri.scheme !== SCHEME) return null;
    return decodeId(uri.authority);
}

/** Same identity as the model URI, as a string. */
export function modelKey(backendId: string, absolutePath: string): string {
    return modelUriFor(backendId, absolutePath).toString();
}

// Every model of a detached machine goes, dirty or not: the placeholder models
// import navigation creates are never disposed by a pane.
registerBackendReset("editor-models", (backendId) => {
    for (const model of monaco.editor.getModels()) {
        if (backendFromModelUri(model.uri) === backendId) model.dispose();
    }
});
