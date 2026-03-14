import {
    createContext,
    useContext,
    useState,
    useCallback,
    useRef,
    useEffect,
    cloneElement,
    isValidElement,
    type ReactNode,
    type RefCallback,
    type RefObject,
    type HTMLAttributes,
} from "react";
import { useFloating, offset, flip, shift, arrow, type Placement } from "@floating-ui/react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import {
    isScrollSuppressed,
    registerTooltip,
    unregisterTooltip,
    mountManager,
    unmountManager,
    type TooltipRegistration,
} from "@/components/ui/tooltip-manager";

// --- React Context ---

interface TooltipContextValue {
    open: boolean;
    setOpen: (open: boolean) => void;
    triggerEl: HTMLElement | null;
    setTriggerEl: RefCallback<HTMLElement>;
    contentRef: RefObject<HTMLElement | null>;
}

const TooltipContext = createContext<TooltipContextValue | null>(null);

function useTooltipContext() {
    const ctx = useContext(TooltipContext);
    if (!ctx) throw new Error("Tooltip components must be used within <Tooltip>");
    return ctx;
}

// --- Components ---

function TooltipProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
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

    const [triggerEl, setTriggerElState] = useState<HTMLElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);

    const setOpen = useCallback(
        (value: boolean) => {
            if (!isControlled) setUncontrolledOpen(value);
            onOpenChange?.(value);
        },
        [isControlled, onOpenChange],
    );

    const setTriggerEl: RefCallback<HTMLElement> = useCallback((el) => {
        setTriggerElState(el);
    }, []);

    return (
        <TooltipContext.Provider value={{ open, setOpen, triggerEl, setTriggerEl, contentRef }}>
            {children}
        </TooltipContext.Provider>
    );
}

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
            if (!isScrollSuppressed()) setOpen(true);
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
        return cloneElement(
            children as React.ReactElement<Record<string, unknown>>,
            // eslint-disable-next-line react-hooks/refs -- setTriggerEl is a state setter callback, not a ref object
            {
                ref: setTriggerEl,
                ...eventHandlers,
            },
        );
    }

    return (
        <span ref={setTriggerEl} {...props} {...eventHandlers}>
            {children}
        </span>
    );
}

const staticSideMap: Record<string, string> = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right",
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
    const { open, setOpen, triggerEl, contentRef } = useTooltipContext();
    const [arrowEl, setArrowEl] = useState<HTMLDivElement | null>(null);

    const {
        refs,
        floatingStyles,
        middlewareData,
        placement: computedPlacement,
        isPositioned,
    } = useFloating({
        open,
        placement: side as Placement,
        middleware: [
            offset(sideOffset),
            flip(),
            shift({ padding: 8 }),
            arrow({ element: arrowEl }),
        ],
        elements: {
            reference: triggerEl,
        },
    });

    // Register/unregister with tooltip manager
    const registrationRef = useRef<TooltipRegistration | null>(null);

    useEffect(() => {
        mountManager();
        return () => unmountManager();
    }, []);

    useEffect(() => {
        if (open && triggerEl) {
            const reg: TooltipRegistration = {
                triggerEl,
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
    }, [open, triggerEl, contentRef, setOpen]);

    if (!open) return null;

    const actualSide = computedPlacement.split("-")[0];
    const staticSide = staticSideMap[actualSide] ?? "top";

    const arrowX = middlewareData.arrow?.x;
    const arrowY = middlewareData.arrow?.y;

    return createPortal(
        <div
            ref={(el) => {
                refs.setFloating(el);
                contentRef.current = el;
            }}
            style={{
                ...floatingStyles,
                visibility: isPositioned ? "visible" : "hidden",
            }}
            className="pointer-events-none z-50 w-fit"
        >
            <div
                className={cn(
                    "bg-foreground text-background max-w-[300px] rounded-md px-3 py-1.5 text-xs text-balance",
                    isPositioned && "animate-in fade-in-0 zoom-in-95",
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
                    ref={setArrowEl}
                    className="bg-foreground fill-foreground absolute z-50 size-2.5 rotate-45 rounded-[2px]"
                    style={{
                        left: arrowX != null ? `${arrowX}px` : "",
                        top: arrowY != null ? `${arrowY}px` : "",
                        right: "",
                        bottom: "",
                        [staticSide]: "-4px",
                    }}
                />
            </div>
        </div>,
        document.body,
    );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
