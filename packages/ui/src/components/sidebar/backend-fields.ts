/**
 * A port field as typed. `undefined` means left blank, which callers read as
 * "not part of this request"; `"invalid"` is a typo the caller must refuse.
 * `Number.parseInt("ssh", 10)` is `NaN`, and a `NaN` port would reach ssh's
 * argv and be written to `backends.json` as `null`. Digits only: `Number`
 * alone reads `0x16` and `1e2` as ports the user never typed.
 */
function parsePort(value: string): number | undefined | "invalid" {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    if (!/^\d+$/.test(trimmed)) return "invalid";
    const parsed = Number(trimmed);
    if (parsed < 1 || parsed > 65535) return "invalid";
    return parsed;
}

/**
 * The sentence a rejected bridge call carries. Electron prefixes a rejection
 * from `ipcMain.handle` with "Error invoking remote method '<channel>': Error: ",
 * which is noise to the person reading it.
 */
function ipcErrorMessage(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;
    const message = error.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
    return message.length > 0 ? message : fallback;
}

export { ipcErrorMessage, parsePort };
