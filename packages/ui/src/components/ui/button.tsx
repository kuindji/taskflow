import * as React from "react";
import { useState, useRef, useEffect, useCallback } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
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

const buttonVariants = cva(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-35 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive:
                    "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
                outline:
                    "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:hover:text-foreground",
                secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "text-foreground/80 hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                transparent: "text-foreground/80 hover:bg-transparent",
                link: "text-primary underline-offset-4 hover:underline",
                sidebar: "text-muted-foreground hover:bg-muted hover:text-foreground",
            },
            size: {
                default: "h-9 px-4 py-2 has-[>svg]:px-3",
                xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
                sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
                lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
                icon: "size-9",
                "icon-2xs": "size-4 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
                "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
                "icon-sm": "size-8",
                "icon-lg": "size-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

type TooltipSide = "top" | "right" | "bottom" | "left";

const staticSideMap: Record<string, string> = {
    top: "bottom",
    right: "left",
    bottom: "top",
    left: "right",
};

/**
 * Renders tooltip content as a portal, positioned relative to a reference element.
 * Used internally by Button to avoid wrapping in Tooltip components
 * (which breaks Radix Slot composition with DropdownMenuTrigger, PopoverTrigger, etc.)
 */
function InlineTooltip({
    open,
    onClose,
    referenceEl,
    side = "top",
    sideOffset = 4,
    children,
}: {
    open: boolean;
    onClose: () => void;
    referenceEl: HTMLElement | null;
    side?: TooltipSide;
    sideOffset?: number;
    children: React.ReactNode;
}) {
    const [arrowEl, setArrowEl] = useState<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);
    const registrationRef = useRef<TooltipRegistration | null>(null);

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
        elements: { reference: referenceEl },
    });

    useEffect(() => {
        mountManager();
        return () => unmountManager();
    }, []);

    useEffect(() => {
        if (open && referenceEl) {
            const reg: TooltipRegistration = {
                triggerEl: referenceEl,
                contentEl: contentRef.current,
                close: onClose,
            };
            registrationRef.current = reg;
            registerTooltip(reg);
            return () => unregisterTooltip(reg);
        }
        if (registrationRef.current) {
            unregisterTooltip(registrationRef.current);
            registrationRef.current = null;
        }
    }, [open, referenceEl, onClose]);

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
            className="pointer-events-none z-50 w-fit">
            <div
                className={cn(
                    "bg-foreground text-background max-w-[300px] rounded-md px-3 py-1.5 text-xs text-balance",
                    isPositioned && "animate-in fade-in-0 zoom-in-95",
                    actualSide === "bottom" && "slide-in-from-top-2",
                    actualSide === "left" && "slide-in-from-right-2",
                    actualSide === "right" && "slide-in-from-left-2",
                    actualSide === "top" && "slide-in-from-bottom-2",
                )}>
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

function Button({
    className,
    variant = "default",
    size = "default",
    asChild = false,
    loading = false,
    tooltip,
    tooltipSide,
    disabled,
    children,
    ...props
}: React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
        loading?: boolean;
        tooltip?: React.ReactNode;
        tooltipSide?: TooltipSide;
    }) {
    const [tooltipOpen, setTooltipOpen] = useState(false);
    // Stored as state (not a ref) so it can be read during render without
    // triggering the react-hooks/refs lint rule, and so that setting a new
    // target element triggers a re-render for correct tooltip positioning.
    const [tooltipTarget, setTooltipTarget] = useState<HTMLElement | null>(null);

    const closeTooltip = useCallback(() => setTooltipOpen(false), []);

    // Separate handled event handlers from the rest so we can merge tooltip
    // behavior without double-binding.
    const {
        onMouseEnter: propsOnMouseEnter,
        onMouseLeave: propsOnMouseLeave,
        onFocus: propsOnFocus,
        onBlur: propsOnBlur,
        onClick: propsOnClick,
        ...restProps
    } = props;

    const handleMouseEnter = tooltip
        ? (e: React.MouseEvent<HTMLButtonElement>) => {
              setTooltipTarget(e.currentTarget);
              propsOnMouseEnter?.(e);
              if (!isScrollSuppressed()) setTooltipOpen(true);
          }
        : propsOnMouseEnter;

    const handleMouseLeave = tooltip
        ? (e: React.MouseEvent<HTMLButtonElement>) => {
              propsOnMouseLeave?.(e);
              setTooltipOpen(false);
          }
        : propsOnMouseLeave;

    const handleFocus = tooltip
        ? (e: React.FocusEvent<HTMLButtonElement>) => {
              setTooltipTarget(e.currentTarget);
              propsOnFocus?.(e);
              setTooltipOpen(true);
          }
        : propsOnFocus;

    const handleBlur = tooltip
        ? (e: React.FocusEvent<HTMLButtonElement>) => {
              propsOnBlur?.(e);
              setTooltipOpen(false);
          }
        : propsOnBlur;

    const handleClick = tooltip
        ? (e: React.MouseEvent<HTMLButtonElement>) => {
              setTooltipOpen(false);
              propsOnClick?.(e);
          }
        : propsOnClick;

    const tooltipPortal =
        tooltip && tooltipOpen ? (
            <InlineTooltip
                open={tooltipOpen}
                onClose={closeTooltip}
                referenceEl={tooltipTarget}
                side={tooltipSide}>
                {tooltip}
            </InlineTooltip>
        ) : null;

    const sharedProps = {
        "data-slot": "button" as const,
        "data-variant": variant,
        "data-size": size,
        className: cn(buttonVariants({ variant, size, className })),
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
        onClick: handleClick,
    };

    if (asChild) {
        return (
            <Slot.Root {...sharedProps} {...restProps}>
                {children}
            </Slot.Root>
        );
    }

    // For disabled buttons with tooltip, wrap in a span to receive mouse events
    // since the button itself has pointer-events: none when disabled.
    if (tooltip && (disabled || loading)) {
        return (
            <span
                className="inline-flex"
                onMouseEnter={(e) => {
                    setTooltipTarget(e.currentTarget);
                    if (!isScrollSuppressed()) setTooltipOpen(true);
                }}
                onMouseLeave={() => setTooltipOpen(false)}>
                <button {...sharedProps} {...restProps} disabled>
                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                    {children}
                </button>
                {tooltipPortal}
            </span>
        );
    }

    return (
        <button {...sharedProps} {...restProps} disabled={disabled || loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {children}
            {tooltipPortal}
        </button>
    );
}

// eslint-disable-next-line react-refresh/only-export-components -- buttonVariants is co-located with Button by design (shadcn/ui pattern)
export { Button, buttonVariants };
