/** Forward wake signals without depending on Electron in the retry lifecycle. */
export function installRemoteWakeup(deps: {
    source: {
        on(event: "resume", listener: () => void): unknown;
        removeListener(event: "resume", listener: () => void): unknown;
    };
    notify(): void;
}): () => void {
    const listener = () => deps.notify();
    deps.source.on("resume", listener);
    return () => {
        deps.source.removeListener("resume", listener);
    };
}
