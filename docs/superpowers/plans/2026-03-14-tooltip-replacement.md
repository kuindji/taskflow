# Tooltip System Replacement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Radix UI tooltip with a custom `@floating-ui/react`-based implementation that reliably dismisses when the mouse leaves the trigger, especially across panel boundaries.

**Architecture:** Single-file rewrite of `tooltip.tsx`. A module-level tooltip manager handles the global safety net. Floating UI handles positioning. The component API is identical to the current Radix-based one, so no consumer changes are needed.

**Tech Stack:** `@floating-ui/react`, React 19, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-14-tooltip-replacement-design.md`

---

## Chunk 1: Implementation

### Task 1: Install @floating-ui/react

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Install the dependency**

```bash
cd packages/ui && bun add @floating-ui/react
```

- [ ] **Step 2: Verify installation**

```bash
grep "@floating-ui/react" packages/ui/package.json
```

Expected: Shows `"@floating-ui/react": "^0.x.x"` in dependencies.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/package.json packages/ui/bun.lock
git commit -m "chore: add @floating-ui/react dependency"
```

---

### Task 2: Rewrite tooltip.tsx

**Files:**
- Rewrite: `packages/ui/src/components/ui/tooltip.tsx`

The complete replacement. The file has three sections: tooltip manager, React context, and the four exported components.

- [ ] **Step 1: Write the tooltip manager**

This is a module-level singleton (not a React component). It manages which tooltip is currently open and runs the global safety-net listener.

```typescript
// --- Tooltip Manager (module-level singleton) ---

interface TooltipRegistration {
    triggerEl: HTMLElement;
    contentEl: HTMLElement | null;
    close: () => void;
}

let currentTooltip: TooltipRegistration | null = null;
let mountCount = 0;

function handleGlobalMouseOver(e: MouseEvent) {
    if (!currentTooltip) return;
    const target = e.target as Node;
    const { triggerEl, contentEl } = currentTooltip;
    if (triggerEl.contains(target) || contentEl?.contains(target)) return;
    currentTooltip.close();
    currentTooltip = null;
}

function registerTooltip(reg: TooltipRegistration) {
    if (currentTooltip && currentTooltip !== reg) {
        currentTooltip.close();
    }
    currentTooltip = reg;
}

function unregisterTooltip(reg: TooltipRegistration) {
    if (currentTooltip === reg) {
        currentTooltip = null;
    }
}

function mountManager() {
    if (mountCount === 0) {
        document.addEventListener("mouseover", handleGlobalMouseOver, true);
    }
    mountCount++;
}

function unmountManager() {
    mountCount--;
    if (mountCount === 0) {
        document.removeEventListener("mouseover", handleGlobalMouseOver, true);
    }
}
```

- [ ] **Step 2: Write the React context and Tooltip root component**

The context passes state from `Tooltip` to `TooltipTrigger` and `TooltipContent`.

```tsx
import {
    createContext,
    useContext,
    useState,
    useCallback,
    useRef,
    useEffect,
    type ReactNode,
    type RefCallback,
} from "react";
import {
    useFloating,
    offset,
    flip,
    shift,
    arrow,
    type Placement,
} from "@floating-ui/react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface TooltipContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
    triggerRef: React.MutableRefObject<HTMLElement | null>;
    setTriggerEl: RefCallback<HTMLElement>;
    contentRef: React.MutableRefObject<HTMLElement | null>;
    placement: Placement;
    sideOffset: number;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext() {
    const ctx = useContext(TooltipContext);
    if (!ctx) throw new Error("Tooltip components must be used within <Tooltip>");
    return ctx;
}

function Tooltip({
    children,
    open: controlledOpen,
    onOpenChange,
}: {
    children: ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : uncontrolledOpen;

    const triggerRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);

    const setOpen = useCallback(
        (value: boolean) => {
            if (!isControlled) setUncontrolledOpen(value);
            onOpenChange?.(value);
        },
        [isControlled, onOpenChange],
    );

    const setTriggerEl: RefCallback<HTMLElement> = useCallback((el) => {
        triggerRef.current = el;
    }, []);

    return (
        <TooltipContext.Provider
            value={{
                open,
                setOpen,
                triggerRef,
                setTriggerEl,
                contentRef,
                placement: "top",
                sideOffset: 4,
            }}
        >
            {children}
        </TooltipContext.Provider>
    );
}
```

- [ ] **Step 3: Write TooltipProvider (no-op wrapper)**

```tsx
function TooltipProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
}
```

- [ ] **Step 4: Write TooltipTrigger**

Handles `mouseenter`/`mouseleave` on the trigger element. Uses `asChild` pattern via cloneElement to forward props/ref to the child.

```tsx
import { cloneElement, isValidElement, type HTMLAttributes } from "react";

function TooltipTrigger({
    children,
    asChild = false,
    ...props
}: {
    children: ReactNode;
    asChild?: boolean;
} & HTMLAttributes<HTMLElement>) {
    const { setOpen, setTriggerEl } = useTooltipContext();

    const eventHandlers = {
        onMouseEnter: (e: React.MouseEvent) => {
            props.onMouseEnter?.(e as React.MouseEvent<HTMLElement>);
            setOpen(true);
        },
        onMouseLeave: (e: React.MouseEvent) => {
            props.onMouseLeave?.(e as React.MouseEvent<HTMLElement>);
            setOpen(false);
        },
        onFocus: (e: React.FocusEvent) => {
            props.onFocus?.(e as React.FocusEvent<HTMLElement>);
            setOpen(true);
        },
        onBlur: (e: React.FocusEvent) => {
            props.onBlur?.(e as React.FocusEvent<HTMLElement>);
            setOpen(false);
        },
    };

    if (asChild && isValidElement(children)) {
        return cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            ref: setTriggerEl,
            ...eventHandlers,
        });
    }

    return (
        <span ref={setTriggerEl} {...props} {...eventHandlers}>
            {children}
        </span>
    );
}
```

- [ ] **Step 5: Write TooltipContent**

Handles positioning via Floating UI, rendering via portal, arrow, animations, and safety-net registration.

```tsx
const sideToPlacement: Record<string, Placement> = {
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
};

function TooltipContent({
    children,
    className,
    side = "top",
    sideOffset = 4,
    ...props
}: {
    children: ReactNode;
    className?: string;
    side?: "top" | "right" | "bottom" | "left";
    sideOffset?: number;
} & React.HTMLAttributes<HTMLDivElement>) {
    const { open, setOpen, triggerRef, contentRef } = useTooltipContext();
    const arrowRef = useRef<HTMLDivElement | null>(null);

    const { refs, floatingStyles, placement: computedPlacement } = useFloating({
        open,
        placement: sideToPlacement[side] ?? "top",
        middleware: [
            offset(sideOffset),
            flip(),
            shift({ padding: 8 }),
            arrow({ element: arrowRef }),
        ],
        elements: {
            reference: triggerRef.current,
        },
    });

    // Register/unregister with tooltip manager
    const registrationRef = useRef<TooltipRegistration | null>(null);

    useEffect(() => {
        mountManager();
        return () => unmountManager();
    }, []);

    useEffect(() => {
        if (open && triggerRef.current) {
            const reg: TooltipRegistration = {
                triggerEl: triggerRef.current,
                contentEl: contentRef.current,
                close: () => setOpen(false),
            };
            registrationRef.current = reg;
            registerTooltip(reg);
            return () => unregisterTooltip(reg);
        }
        if (registrationRef.current) {
            unregisterTooltip(registrationRef.current);
            registrationRef.current = null;
        }
    }, [open, triggerRef, contentRef, setOpen]);

    if (!open) return null;

    const actualSide = computedPlacement.split("-")[0];

    return createPortal(
        <div
            ref={(el) => {
                refs.setFloating(el);
                contentRef.current = el;
            }}
            style={floatingStyles}
            className={cn(
                "pointer-events-none animate-in bg-foreground text-background fade-in-0 zoom-in-95 z-50 w-fit max-w-[300px] rounded-md px-3 py-1.5 text-xs text-balance",
                actualSide === "bottom" && "slide-in-from-top-2",
                actualSide === "left" && "slide-in-from-right-2",
                actualSide === "right" && "slide-in-from-left-2",
                actualSide === "top" && "slide-in-from-bottom-2",
                className,
            )}
            {...props}
        >
            {children}
            <div
                ref={arrowRef}
                className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] absolute"
            />
        </div>,
        document.body,
    );
}
```

Note: The arrow positioning will need adjustment — Floating UI's `arrow` middleware provides `x`/`y` data via `middlewareData.arrow` which must be applied as inline styles on the arrow element. The implementer should use `useFloating`'s return value to get `middlewareData` and position the arrow accordingly. The exact styles depend on which side the tooltip is on:
- `top`: arrow at bottom, `bottom: -4px`, `left: {x}px`
- `bottom`: arrow at top, `top: -4px`, `left: {x}px`
- `left`: arrow at right, `right: -4px`, `top: {y}px`
- `right`: arrow at left, `left: -4px`, `top: {y}px`

- [ ] **Step 6: Wire up exports**

```tsx
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
```

- [ ] **Step 7: Verify the build compiles**

```bash
cd packages/ui && bun run typecheck
```

Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/ui/tooltip.tsx
git commit -m "feat: replace Radix tooltip with custom @floating-ui/react implementation"
```

---

### Task 3: Manual verification

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/kuindji/Projects/taskflow && bun run dev
```

- [ ] **Step 2: Verify tooltips appear and dismiss correctly**

Test these scenarios:
1. Hover a sidebar button → tooltip appears → move mouse away → tooltip disappears immediately
2. Hover a sidebar button → move mouse quickly to a terminal panel → tooltip disappears immediately
3. Hover a tab bar button → tooltip appears with arrow → correct positioning
4. Check `TruncatedText` tooltips (e.g., long task names) → only show when text is actually truncated
5. Check `Button` tooltips → appear/disappear correctly
6. Verify animations: fade-in, zoom-in, slide transitions all work

- [ ] **Step 3: Commit any fixes if needed**
