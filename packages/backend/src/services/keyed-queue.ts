/**
 * One promise chain per key: steps for a key run one at a time in call
 * order, and a failed step does not stop the ones queued behind it.
 */
class KeyedQueue {
    private readonly tails = new Map<string, Promise<void>>();

    run<T>(key: string, step: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        const result = previous.then(step);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.tails.set(key, tail);
        void tail.then(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
        });
        return result;
    }

    /** Resolves once every step queued so far has settled. */
    async drain(): Promise<void> {
        await Promise.all(this.tails.values());
    }
}

export { KeyedQueue };
