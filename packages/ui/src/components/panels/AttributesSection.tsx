import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Attribute, AttributeLayer, AttributeOwner } from "@taskflow/shared";
import { hasNameConflict, normalizeAttributeName, resolveAttributes } from "@taskflow/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    createAttribute,
    deleteAttribute,
    updateAttribute,
} from "@/lib/attribute-api";

const SAVE_DEBOUNCE_MS = 500;

interface AttributesSectionProps {
    owner: AttributeOwner;
    /** Own attributes, editable here. */
    attributes: Attribute[];
    /** Lower-precedence layers, read-only. Empty for a project. */
    inheritedLayers: AttributeLayer[];
    /** Prefix for input ids, so task and project panels don't collide. */
    idPrefix: string;
}

type DraftField = "name" | "value";
type Drafts = Record<string, Partial<Record<DraftField, string>>>;

const scopeLabels: Record<string, string> = {
    project: "project",
    parent: "parent task",
    task: "task",
};

function AttributesSection({
    owner,
    attributes,
    inheritedLayers,
    idPrefix,
}: AttributesSectionProps) {
    const [error, setError] = useState<string | null>(null);
    // A field with a draft is being edited; without one it renders the store
    // value. Clearing a draft is how a settled save hands control back to the
    // store.
    const [drafts, setDrafts] = useState<Drafts>({});
    // Pending debounced saves, keyed `${attrId}:${field}`. Each entry keeps its
    // own `run` so it can be flushed early — on blur, on owner switch, or on
    // unmount — with the exact owner and text captured when it was scheduled.
    const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());

    // The component's own layer is always shadowed out of `inherited` below
    // (it's filtered by id), so this scope label never actually renders — but
    // keep it honest for the owner kind rather than hardcoding "task", since
    // this same component renders a project's own attributes too.
    const ownScope = owner.taskId ? "task" : "project";

    // Inherited rows shadowed by an own attribute must not be shown, so resolve
    // the full stack and keep only the entries the own list did not shadow.
    const inherited = useMemo(() => {
        const resolved = resolveAttributes([
            ...inheritedLayers,
            { scope: ownScope, attributes },
        ]);
        return resolved.filter((a) => !attributes.some((own) => own.id === a.id));
    }, [attributes, inheritedLayers, ownScope]);

    const setDraft = useCallback((attrId: string, field: DraftField, text: string) => {
        setDrafts((current) => ({
            ...current,
            [attrId]: { ...current[attrId], [field]: text },
        }));
    }, []);

    /**
     * Hand the field back to the store, but only if the user has not typed past
     * what this save carried. Clearing unconditionally would revert a newer
     * draft to the older value an in-flight request is about to confirm.
     */
    const clearDraftIfUnchanged = useCallback(
        (attrId: string, field: DraftField, text: string) => {
            setDrafts((current) => {
                const entry = current[attrId];
                if (!entry || entry[field] !== text) return current;
                const { [field]: _cleared, ...remaining } = entry;
                if (Object.keys(remaining).length === 0) {
                    const { [attrId]: _removed, ...next } = current;
                    return next;
                }
                return { ...current, [attrId]: remaining };
            });
        },
        [],
    );

    const flush = useCallback((key: string) => {
        const entry = pending.current.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.current.delete(key);
        entry.run();
    }, []);

    const schedule = useCallback((key: string, run: () => void) => {
        const existing = pending.current.get(key);
        if (existing) clearTimeout(existing.timer);
        pending.current.set(key, {
            timer: setTimeout(() => {
                pending.current.delete(key);
                run();
            }, SAVE_DEBOUNCE_MS),
            run,
        });
    }, []);

    // Flush rather than drop on owner switch and unmount: a debounced edit the
    // user made just before closing the panel must still reach the server, and
    // it must reach the owner it was typed against.
    //
    // Keyed on a stable primitive (not `owner` itself): callers commonly pass
    // an inline object literal, which is a fresh reference on every render, so
    // depending on `owner` would flush on any unrelated parent re-render and
    // wipe whatever the user is mid-typing. The cleanup only ever reads the
    // `pending` ref, never `owner`, so it stays correct even though `owner`
    // isn't in the deps.
    const ownerKey = owner.taskId ?? owner.projectId;
    useEffect(() => {
        const inFlight = pending.current;
        return () => {
            for (const entry of [...inFlight.values()]) {
                clearTimeout(entry.timer);
                entry.run();
            }
            inFlight.clear();
        };
    }, [ownerKey]);

    /**
     * Builds the save for one edit, capturing the owner and sibling list from
     * the render that produced the keystroke. A flush that fires after the
     * panel switched tasks therefore still writes to the right owner.
     */
    const makeCommit = useCallback(
        (attribute: Attribute, field: DraftField, text: string): (() => void) => {
            const targetOwner = owner;
            const siblings = attributes;
            const settle = () => clearDraftIfUnchanged(attribute.id, field, text);

            return () => {
                if (field === "value") {
                    if (text === attribute.value) {
                        settle();
                        return;
                    }
                    setError(null);
                    void updateAttribute(targetOwner, attribute.id, { value: text })
                        .then(settle)
                        .catch((err: unknown) => {
                            setError(
                                err instanceof Error ? err.message : "Failed to update attribute",
                            );
                            settle();
                        });
                    return;
                }

                const name = normalizeAttributeName(text);
                if (name === attribute.name) {
                    settle();
                    return;
                }
                // These two are local, synchronous rejections, not a server
                // round-trip: nothing else can resolve them, so `settle()` here
                // would always match against the very text that just failed
                // and wipe it out from under the user's cursor. Leave the
                // draft alone so they can keep editing.
                if (!name) {
                    setError("Attribute name cannot be empty");
                    return;
                }
                if (hasNameConflict(siblings, name, attribute.id)) {
                    setError(`"${name}" already exists here`);
                    return;
                }
                setError(null);
                void updateAttribute(targetOwner, attribute.id, { name })
                    .then(settle)
                    .catch((err: unknown) => {
                        setError(
                            err instanceof Error ? err.message : "Failed to rename attribute",
                        );
                        settle();
                    });
            };
        },
        [attributes, clearDraftIfUnchanged, owner],
    );

    const handleChange = useCallback(
        (attribute: Attribute, field: DraftField, text: string) => {
            setDraft(attribute.id, field, text);
            schedule(`${attribute.id}:${field}`, makeCommit(attribute, field, text));
        },
        [makeCommit, schedule, setDraft],
    );

    const addAttribute = useCallback(() => {
        let candidate = "new-attribute";
        let suffix = 2;
        while (hasNameConflict(attributes, candidate)) {
            candidate = `new-attribute-${suffix}`;
            suffix += 1;
        }
        setError(null);
        void createAttribute(owner, candidate, "").catch((err: unknown) => {
            setError(err instanceof Error ? err.message : "Failed to add attribute");
        });
    }, [attributes, owner]);

    const removeAttribute = useCallback(
        (attrId: string) => {
            setError(null);
            void deleteAttribute(owner, attrId).catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Failed to delete attribute");
            });
        },
        [owner],
    );

    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">Attributes</span>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={addAttribute}
                    aria-label="Add attribute"
                    tooltip="Add attribute"
                    tooltipSide="bottom">
                    <Plus className="h-3 w-3" />
                </Button>
            </div>

            {inherited.length > 0 && (
                <div className="mt-2 space-y-1">
                    {inherited.map((attribute) => (
                        <div
                            key={attribute.id}
                            className="flex items-center gap-2 text-xs opacity-70">
                            <span className="border-border text-muted-foreground shrink-0 rounded border px-1 py-0.5 text-[10px]">
                                {scopeLabels[attribute.scope] ?? attribute.scope}
                            </span>
                            <span className="text-secondary-foreground min-w-0 flex-1 truncate">
                                {attribute.name}
                            </span>
                            <span className="text-muted-foreground min-w-0 flex-1 truncate">
                                {attribute.value}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-2 space-y-1">
                {attributes.map((attribute) => (
                    <div key={attribute.id} className="flex items-center gap-1">
                        <Input
                            id={`${idPrefix}-attr-name-${attribute.id}`}
                            aria-label="Attribute name"
                            value={drafts[attribute.id]?.name ?? attribute.name}
                            onChange={(e) => handleChange(attribute, "name", e.target.value)}
                            onBlur={() => flush(`${attribute.id}:name`)}
                            placeholder="name"
                            className="h-7 flex-1 text-xs"
                        />
                        <Input
                            id={`${idPrefix}-attr-value-${attribute.id}`}
                            aria-label="Attribute value"
                            value={drafts[attribute.id]?.value ?? attribute.value}
                            onChange={(e) => handleChange(attribute, "value", e.target.value)}
                            onBlur={() => flush(`${attribute.id}:value`)}
                            placeholder="value"
                            className="h-7 flex-1 text-xs"
                        />
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => removeAttribute(attribute.id)}
                            aria-label={`Delete attribute ${attribute.name}`}
                            tooltip="Delete attribute"
                            tooltipSide="bottom">
                            <Trash2 className="h-3 w-3" />
                        </Button>
                    </div>
                ))}
            </div>

            {attributes.length === 0 && inherited.length === 0 && (
                <p className="text-muted-foreground mt-1 text-xs">No attributes yet.</p>
            )}

            {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
        </div>
    );
}

export { AttributesSection };
