/** A record tagged with the connection that delivered it. The protocol never carries this. */
export type Scoped<T> = T & { backendId: string };

type Write<T> = (items: Scoped<T>[]) => Scoped<T>[];

interface Slice<T> {
    items: Scoped<T>[];
    /** Bumped by every write. A list response taken before a write is stale. */
    revision: number;
    /** Bumped by every `begin()`. Only the newest request may land. */
    generation: number;
    /**
     * The writes since the newest `begin()`, while its response is awaited;
     * null when no response is. A stale response is rebased onto these.
     */
    pending: Write<T>[] | null;
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
            slice = { items: [], revision: 0, generation: 0, pending: null };
            slices.set(backendId, slice);
        }
        return slice;
    }

    const scope = {
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
         * `revision` tells whether events or optimistic writes landed mid-flight.
         */
        begin(backendId: string): FetchToken {
            const slice = sliceFor(backendId);
            slice.generation++;
            slice.pending = [];
            return { revision: slice.revision, generation: slice.generation };
        },
        /**
         * Land the newest request's response. When writes landed while it was in
         * flight, they are replayed over it rather than the response being
         * discarded: nothing else refetches, so discarding would leave a machine
         * that broadcast an update mid-list without its records until the next
         * attach. Every store write is a function of the items it is given
         * (upsert, replace by id, filter, reorder), so a replay keeps the newer
         * state and the snapshot's records both. The response may already hold
         * a write's effect, so a write must also be safe to repeat: an insert
         * checks for the id inside the write, not before calling `apply`.
         *
         * Whether the response landed; false when a later request superseded it
         * or its machine was dropped.
         */
        replace(backendId: string, items: T[], token: FetchToken): boolean {
            // A dropped machine's late response must not bring its slice back.
            const slice = slices.get(backendId);
            if (!slice || slice.generation !== token.generation) return false;
            let next = items.map((item) => ({ ...item, backendId }));
            if (slice.revision !== token.revision) {
                for (const write of slice.pending ?? []) next = write(next);
            }
            slice.items = next;
            slice.pending = null;
            slice.revision++;
            return true;
        },
        /** `begin`, request, `replace`; a request that fails stops the slice keeping writes for it. */
        async load(backendId: string, request: () => Promise<T[]>): Promise<boolean> {
            const token = scope.begin(backendId);
            try {
                return scope.replace(backendId, await request(), token);
            } finally {
                const slice = slices.get(backendId);
                if (slice?.generation === token.generation) slice.pending = null;
            }
        },
        apply(backendId: string, fn: Write<T>): void {
            const slice = sliceFor(backendId);
            slice.items = fn(slice.items);
            slice.pending?.push(fn);
            slice.revision++;
        },
        drop(backendId: string): void {
            slices.delete(backendId);
        },
        backends(): string[] {
            return [...slices.keys()];
        },
    };
    return scope;
}
