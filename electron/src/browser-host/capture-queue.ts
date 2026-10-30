// Captures run one at a time, and the queue waits for Chromium's real completion even
// after a caller's deadline. Each deadline starts when its caller enqueues, so a capture
// that never settles can't stall the callers behind it.
export function createCaptureQueue(timeoutMs: number) {
    let tail: Promise<unknown> = Promise.resolve();
    return (capture: () => Promise<string>): Promise<string> => {
        const run = tail.then(capture).catch(() => "");
        tail = run;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<string>((resolve) => {
            timer = setTimeout(() => {
                resolve("");
            }, timeoutMs);
        });
        return Promise.race([run, deadline]).finally(() => {
            clearTimeout(timer);
        });
    };
}
