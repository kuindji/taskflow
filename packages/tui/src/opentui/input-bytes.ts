function inputBytesToString(bytes: Uint8Array): string | null {
    if (bytes.byteLength === 0) return null;
    let decoded: string;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
    const encoded = new TextEncoder().encode(decoded);
    if (encoded.byteLength !== bytes.byteLength) return null;
    for (let i = 0; i < bytes.byteLength; i += 1) {
        if (encoded[i] !== bytes[i]) return null;
    }
    return decoded;
}

export { inputBytesToString };
