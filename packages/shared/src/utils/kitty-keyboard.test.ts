import { describe, test, expect } from "bun:test";
import { KittyKeyboardStack } from "./kitty-keyboard";

describe("KittyKeyboardStack", () => {
    test("starts outside the protocol", () => {
        expect(new KittyKeyboardStack().flags).toBeNull();
    });

    test("a single push and pop returns to legacy", () => {
        const stack = new KittyKeyboardStack();
        stack.push(1);
        expect(stack.flags).toBe(1);
        stack.pop(0);
        expect(stack.flags).toBeNull();
    });

    test("a nested push restores the outer flags when popped", () => {
        const stack = new KittyKeyboardStack();
        stack.push(1);
        stack.push(5);
        expect(stack.flags).toBe(5);
        stack.pop(1);
        expect(stack.flags).toBe(1);
    });

    test("pops several entries at once", () => {
        const stack = new KittyKeyboardStack();
        stack.push(1);
        stack.push(5);
        stack.push(9);
        stack.pop(2);
        expect(stack.flags).toBe(1);
    });

    test("a pop that empties the stack resets the flags", () => {
        const stack = new KittyKeyboardStack();
        stack.push(1);
        stack.push(5);
        stack.pop(7);
        expect(stack.flags).toBeNull();
    });

    test("popping with nothing pushed stays outside the protocol", () => {
        const stack = new KittyKeyboardStack();
        stack.pop(1);
        expect(stack.flags).toBeNull();
    });

    test("evicts the oldest entry rather than growing without bound", () => {
        const stack = new KittyKeyboardStack();
        for (let i = 1; i <= 40; i += 1) stack.push(i);
        expect(stack.flags).toBe(40);
        // Only the 16 most recent pushes are recoverable; the rest were evicted,
        // so popping past them resets instead of restoring an ancient value.
        stack.pop(16);
        expect(stack.flags).toBe(24);
        stack.pop(1);
        expect(stack.flags).toBeNull();
    });

    test("reports the whole stack, flags in force last", () => {
        const stack = new KittyKeyboardStack();
        expect(stack.toArray()).toEqual([]);
        stack.push(1);
        stack.push(5);
        expect(stack.toArray()).toEqual([null, 1, 5]);
    });

    test("restore replaces the whole stack and pops back through it", () => {
        const stack = new KittyKeyboardStack();
        stack.push(9);
        stack.restore([null, 1, 5]);
        expect(stack.flags).toBe(5);
        stack.pop(1);
        expect(stack.flags).toBe(1);
        stack.pop(1);
        expect(stack.flags).toBeNull();
    });

    test("restoring an empty stack leaves the protocol", () => {
        const stack = new KittyKeyboardStack();
        stack.push(1);
        stack.restore([]);
        expect(stack.flags).toBeNull();
        expect(stack.toArray()).toEqual([]);
    });

    test("a restored stack round-trips through toArray", () => {
        const source = new KittyKeyboardStack();
        source.push(1);
        source.push(5);
        const target = new KittyKeyboardStack();
        target.restore(source.toArray());
        expect(target.toArray()).toEqual(source.toArray());
    });
});
