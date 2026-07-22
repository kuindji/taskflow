import { expect, test, beforeEach, mock } from "bun:test";
import { act, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Attribute, AttributeLayer, AttributeOwner } from "@taskflow/shared";

// The component resolves attribute-api through the repo's own `@/` tsconfig
// alias, so intercept that exact specifier rather than a relative path — Bun
// resolves both to the same module, and mocking the alias matches how the
// component actually imports it.
interface Call {
    kind: string;
    owner: AttributeOwner;
    attrId?: string;
    updates?: { name?: string; value?: string };
}
const calls: Call[] = [];
let gate: { resolve: () => void; reject: (e: Error) => void } | null = null;
let gateNext = false;

function apiCall(c: Call): Promise<void> {
    calls.push(c);
    if (!gateNext) return Promise.resolve();
    gateNext = false;
    return new Promise<void>((res, rej) => {
        gate = {
            resolve: res,
            reject: (e) => {
                rej(e);
            },
        };
    });
}

await mock.module("@/lib/attribute-api", () => ({
    createAttribute: (owner: AttributeOwner, name: string, value: string) =>
        apiCall({ kind: "create", owner, updates: { name, value } }),
    updateAttribute: (owner: AttributeOwner, attrId: string, updates: { name?: string; value?: string }) =>
        apiCall({ kind: "update", owner, attrId, updates }),
    deleteAttribute: (owner: AttributeOwner, attrId: string) => apiCall({ kind: "delete", owner, attrId }),
}));

const { AttributesSection } = await import("./AttributesSection");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let prevRoot: Root | null = null;
let setStoreAttributes: (a: Attribute[]) => void;
let setOwnerId: (id: string) => void;
let setMounted: (m: boolean) => void;
let bumpParent: () => void;

/**
 * Mounts with `owner` recomputed via useMemo on `ownerId`, mirroring a
 * well-behaved caller (owner only changes reference on a real switch).
 */
function mount(initial: Attribute[], inheritedLayers: AttributeLayer[] = []) {
    function Parent() {
        const [attributes, setAttributes] = useState(initial);
        const [ownerId, setOid] = useState("t1");
        const [mounted, setM] = useState(true);
        // Expose the setters to the module-scope harness variables the tests
        // drive from outside `act()`. Done in an effect (post-render), not
        // during render, to keep the component body pure.
        useEffect(() => {
            setStoreAttributes = setAttributes;
            setOwnerId = setOid;
            setMounted = setM;
        }, [setAttributes, setOid, setM]);
        const owner = useMemo<AttributeOwner>(() => ({ taskId: ownerId }), [ownerId]);
        if (!mounted) return null;
        return (
            <AttributesSection
                owner={owner}
                attributes={attributes}
                inheritedLayers={inheritedLayers}
                idPrefix="task-info"
            />
        );
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<Parent />);
    });
    prevRoot = root;
}

/**
 * Mounts with `owner` as an inline object literal — mirrors
 * TaskInfoPanel.tsx, which passes `owner={{ taskId: task.id }}` /
 * `owner={{ projectId: project.id }}` fresh on every render. Used by the two
 * regression tests below to reproduce the original defects.
 */
function mountWithInlineOwner(attributes: Attribute[]) {
    function Parent() {
        const [, setTick] = useState(0);
        useEffect(() => {
            bumpParent = () => {
                setTick((n) => n + 1);
            };
        }, [setTick]);
        return (
            <AttributesSection
                owner={{ taskId: "t1" }}
                attributes={attributes}
                inheritedLayers={[]}
                idPrefix="task-info"
            />
        );
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<Parent />);
    });
    prevRoot = root;
}

function typeInto(id: string, text: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`);
    if (!input) throw new Error(`no input ${id}`);
    act(() => {
        // React 19 attaches its own value setter; go through the native one so
        // the synthetic change event carries the new value.
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function blur(id: string) {
    const input = container.querySelector<HTMLInputElement>(`#${id}`);
    act(() => {
        input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
}

const valueOf = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "<missing>";
const text = () => container.textContent ?? "";
const inheritedRows = () => [...container.querySelectorAll("div.opacity-70")].map((d) => d.textContent);

async function waitDebounce() {
    await act(async () => {
        await new Promise((r) => setTimeout(r, 700));
    });
}

beforeEach(() => {
    if (prevRoot) {
        const r = prevRoot;
        act(() => {
            r.unmount();
        });
        prevRoot = null;
    }
    calls.length = 0;
    gate = null;
    gateNext = false;
});

test("a store update with no local draft is reflected in the field (controlled, not uncontrolled)", () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    expect(valueOf("task-info-attr-value-a1")).toBe("prod");

    act(() => {
        setStoreAttributes([{ id: "a1", name: "env", value: "agent-wrote-this" }]);
    });
    expect(valueOf("task-info-attr-value-a1")).toBe("agent-wrote-this");
});

test("owner captured at schedule time: switching task inside the debounce window still writes to the old owner", () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    typeInto("task-info-attr-value-a1", "staging");

    act(() => {
        setOwnerId("t2");
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toEqual({ taskId: "t1" });
    expect(calls[0]?.updates).toEqual({ value: "staging" });
});

test("sibling list for duplicate-name validation is also captured at schedule time", () => {
    mount([
        { id: "a1", name: "region", value: "" },
        { id: "a2", name: "env", value: "" },
    ]);
    // "env" collides with the sibling that exists RIGHT NOW.
    typeInto("task-info-attr-name-a1", "env");
    // Owner switches; the pending save flushes against the captured siblings.
    act(() => {
        setOwnerId("t2");
    });
    expect(calls).toHaveLength(0); // conflict caught locally, no write
    expect(text()).toContain('"env" already exists here');
});

test("stale-clear guard: a reply for an earlier value must not revert a field showing newer text", async () => {
    mount([{ id: "a1", name: "env", value: "" }]);
    gateNext = true;
    typeInto("task-info-attr-value-a1", "ab");
    await waitDebounce();
    expect(calls).toHaveLength(1); // "ab" in flight

    typeInto("task-info-attr-value-a1", "abc");
    act(() => {
        gate?.resolve();
    });
    await act(async () => {
        await Promise.resolve();
    });

    expect(valueOf("task-info-attr-value-a1")).toBe("abc");
});

test("a rejected rename (server round-trip) reverts the field to the store value and surfaces the error", async () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    gateNext = true;
    typeInto("task-info-attr-name-a1", "envx");
    await waitDebounce();
    expect(calls).toHaveLength(1);

    await act(async () => {
        gate?.reject(new Error("name already taken"));
        await new Promise((r) => setTimeout(r, 0));
    });

    expect(valueOf("task-info-attr-name-a1")).toBe("env"); // reverted to store value
    expect(text()).toContain("name already taken");
});

test("pending save is flushed on blur", () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    typeInto("task-info-attr-value-a1", "staging");
    expect(calls).toHaveLength(0);
    blur("task-info-attr-value-a1");
    expect(calls).toHaveLength(1);
});

test("pending save is flushed on a real owner switch", () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    typeInto("task-info-attr-value-a1", "staging");
    expect(calls).toHaveLength(0);
    act(() => {
        setOwnerId("t2");
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toEqual({ taskId: "t1" });
});

test("pending save is flushed on unmount", () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    typeInto("task-info-attr-value-a1", "staging");
    expect(calls).toHaveLength(0);
    act(() => {
        setMounted(false);
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.owner).toEqual({ taskId: "t1" });
});

test("no timer outlives the component (no leaked setTimeout after unmount)", async () => {
    mount([{ id: "a1", name: "env", value: "prod" }]);
    typeInto("task-info-attr-value-a1", "staging");
    act(() => {
        setMounted(false);
    });
    const after = calls.length;
    await new Promise((r) => setTimeout(r, 700));
    expect(calls).toHaveLength(after); // timer was cleared, not left to fire again
});

test("inherited list: task case, shadowed rows hidden, precedence respected", () => {
    mount(
        [{ id: "t-env", name: "env", value: "dev" }],
        [
            {
                scope: "project",
                attributes: [
                    { id: "p-env", name: "env", value: "prod" },
                    { id: "p-region", name: "region", value: "eu" },
                ],
            },
            {
                scope: "parent",
                attributes: [
                    { id: "par-region", name: "region", value: "us" },
                    { id: "par-tier", name: "tier", value: "gold" },
                ],
            },
        ],
    );
    const rows = inheritedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("region");
    expect(rows[0]).toContain("us"); // parent beats project
    expect(rows[0]).toContain("parent task");
    expect(rows[1]).toContain("tier");
    expect(text()).not.toContain("prod"); // project env shadowed by task env
    expect(valueOf("task-info-attr-value-t-env")).toBe("dev");
});

test("inherited list: project case (empty inheritedLayers) yields nothing", () => {
    mount([{ id: "p1", name: "env", value: "prod" }], []);
    expect(inheritedRows()).toHaveLength(0);
    expect(valueOf("task-info-attr-value-p1")).toBe("prod");
});

test("a transient local name conflict does not wipe in-progress text after the debounce alone", async () => {
    mount([
        { id: "a1", name: "region", value: "" },
        { id: "a2", name: "env", value: "" },
    ]);
    // Renaming "region" -> "env-west"; the user pauses after typing "env".
    typeInto("task-info-attr-name-a1", "env");
    await waitDebounce();

    // The field still holds what the user typed, so they can finish it.
    expect(valueOf("task-info-attr-name-a1")).toBe("env");
});

test("clearing a name field to retype it stays empty after the debounce (does not refill from the store)", async () => {
    mount([{ id: "a1", name: "region", value: "" }]);
    typeInto("task-info-attr-name-a1", ""); // select-all + delete
    await waitDebounce();
    // The field stays empty so the user can type the new name.
    expect(valueOf("task-info-attr-name-a1")).toBe("");
});

test("REGRESSION (Finding 1): an unrelated parent re-render does not flush a pending debounced save", () => {
    mountWithInlineOwner([{ id: "a1", name: "env", value: "prod" }]);

    typeInto("task-info-attr-value-a1", "p");
    expect(calls).toHaveLength(0); // debounce (500ms) has not elapsed

    // Simulate any TASK_UPDATED broadcast: task-store replaces `tasks`, which
    // useActiveWorkspace subscribes to, so TaskInfoPanel re-renders with a
    // brand-new inline `owner={{ taskId: ... }}` object. No owner change —
    // same task, same panel.
    act(() => {
        bumpParent();
    });

    expect(calls).toHaveLength(0);
});

test("REGRESSION (Finding 1): mid-typing text survives an unrelated parent re-render", () => {
    mountWithInlineOwner([
        { id: "a1", name: "region", value: "" },
        { id: "a2", name: "env", value: "" },
    ]);

    // User is renaming "region" -> "env-west"; "env" is a transient prefix.
    typeInto("task-info-attr-name-a1", "env");
    expect(valueOf("task-info-attr-name-a1")).toBe("env");

    act(() => {
        bumpParent();
    });

    expect(valueOf("task-info-attr-name-a1")).toBe("env");
});
