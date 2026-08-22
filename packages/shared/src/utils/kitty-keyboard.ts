/**
 * Tracks the kitty keyboard protocol flag stack a child terminal maintains.
 *
 * The protocol keeps a stack, not a single value: `CSI > flags u` pushes the
 * current flags and installs new ones, `CSI < number u` pops that many entries
 * back. A shell that speaks the protocol and an editor started inside it both
 * push, so collapsing the stack to one value loses the shell's flags the moment
 * the editor exits. Nothing in xterm's model carries this, so both the backend's
 * headless mirror and each client track it from the same output stream.
 */

/** Kitty's own limit; a child spamming pushes must not grow this without bound. */
const KITTY_STACK_LIMIT = 16;

class KittyKeyboardStack {
    private current: number | null = null;
    private readonly stack: (number | null)[] = [];

    /** The flags in force, or null if the child is not in the protocol. */
    get flags(): number | null {
        return this.current;
    }

    /** Handles `CSI > flags u`. Omitted flags default to zero, per the spec. */
    push(flags: number): void {
        this.stack.push(this.current);
        if (this.stack.length > KITTY_STACK_LIMIT) this.stack.shift();
        this.current = flags;
    }

    /**
     * Handles `CSI < number u`. A pop that empties the stack resets the flags,
     * which this models as leaving the protocol entirely.
     */
    pop(count: number): void {
        const times = count > 0 ? count : 1;
        let restored: number | null = null;
        for (let i = 0; i < times; i += 1) {
            if (this.stack.length === 0) {
                restored = null;
                break;
            }
            restored = this.stack.pop() ?? null;
        }
        this.current = restored;
    }

    /**
     * The whole stack, outermost first, with the flags in force last; empty when
     * the child is outside the protocol. A client attaching to a session already
     * nested (a shell pushed, then an editor pushed) needs every entry, not just
     * the top: the editor's pop has to restore the shell's flags, not legacy.
     */
    toArray(): (number | null)[] {
        return this.current === null ? [] : [...this.stack, this.current];
    }

    /** Adopts a stack reported out of band, e.g. by a session snapshot. */
    restore(entries: readonly (number | null)[]): void {
        this.stack.length = 0;
        for (const entry of entries.slice(0, -1)) this.stack.push(entry);
        this.current = entries.length === 0 ? null : (entries[entries.length - 1] ?? null);
    }
}

export { KittyKeyboardStack };
