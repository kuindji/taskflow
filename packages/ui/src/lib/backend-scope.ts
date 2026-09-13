/** A record tagged with the connection that delivered it. The protocol never carries this. */
export type Scoped<T> = T & { backendId: string };

interface Slice<T> {
    items: Scoped<T>[];
    /** Bumped by every write. A list response taken before a write is stale. */
    revision: number;
    /** Bumped by every `begin()`. Only the newest request may land. */
    generation: number;
}

/** What `begin()` hands back and `replace()` requires. */
interface FetchToken {
    revision: number;
    generation: number;
}

/**
 * Per-backend slices behind a merged read.
 *
 * Two hazards make the slices necessary rather than tidy. A whole-array replace
 * erases other backends' records when one backend's fetch resolves. And a list
 * response is a snapshot: if an event — or a local optimistic write — lands
 * while the request is in flight, the response is older than the state it would
 * overwrite. `begin()` before the request and `replace(..., token)` after is how
 * both are avoided.
 */
export function createSlices<T>() {
    const slices = new Map<string, Slice<T>>();

    function sliceFor(backendId: string): Slice<T> {
        let slice = slices.get(backendId);
        if (!slice) {
            slice = { items: [], revision: 0, generation: 0 };
            slices.set(backendId, slice);
        }
        return slice;
    }

    return {
        read(): Scoped<T>[] {
            return [...slices.values()].flatMap((slice) => slice.items);
        },
        /**
         * Claim the right to replace this slice. Call immediately before the
         * request; pass the result to `replace` when it resolves.
         *
         * Two counters, not one, because a single counter conflates two
         * different staleness questions and gets the second wrong. With one
         * counter, two concurrent fetches both start at revision 0; the older
         * resolves first, writes, and bumps to 1; the newer — carrying the
         * fresher data — then sees 0 !== 1 and is discarded, so a project just
         * created on that machine stays missing until the next detach and
         * reattach. `generation` orders requests against each other;
         * `revision` guards against events and optimistic writes landing
         * mid-flight. A response must survive both.
         */
        begin(backendId: string): FetchToken {
            const slice = sliceFor(backendId);
            slice.generation++;
            return { revision: slice.revision, generation: slice.generation };
        },
        /** Whether the response landed; false when it was stale and discarded. */
        replace(backendId: string, items: T[], token: FetchToken): boolean {
            const slice = sliceFor(backendId);
            // Superseded by a later request, or overtaken by a write.
            if (slice.generation !== token.generation) return false;
            if (slice.revision !== token.revision) return false;
            slice.items = items.map((item) => ({ ...item, backendId }));
            slice.revision++;
            return true;
        },
        apply(backendId: string, fn: (items: Scoped<T>[]) => Scoped<T>[]): void {
            const slice = sliceFor(backendId);
            slice.items = fn(slice.items);
            slice.revision++;
        },
        drop(backendId: string): void {
            slices.delete(backendId);
        },
        backends(): string[] {
            return [...slices.keys()];
        },
    };
}
