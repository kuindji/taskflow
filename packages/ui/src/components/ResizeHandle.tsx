import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    panelGap: number;
    orientation?: "vertical" | "horizontal";
    align?: "start" | "center" | "end";
    className?: string;
}

function ResizeHandle({
    onResize,
    onResizeEnd,
    panelGap,
    orientation = "vertical",
    align = "center",
    className,
}: ResizeHandleProps) {
    const startPositionRef = useRef(0);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            startPositionRef.current = orientation === "vertical" ? e.clientX : e.clientY;
            isDraggingRef.current = true;
            setIsDragging(true);

            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!isDraggingRef.current) return;
                const nextPosition =
                    orientation === "vertical" ? moveEvent.clientX : moveEvent.clientY;
                const delta = nextPosition - startPositionRef.current;
                startPositionRef.current = nextPosition;
                onResize(delta);
            };

            const handleMouseUp = () => {
                isDraggingRef.current = false;
                setIsDragging(false);
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                onResizeEnd?.();
            };

            document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        },
        [onResize, onResizeEnd, orientation],
    );

    const lineStyle =
        orientation === "vertical"
            ? {
                  backgroundImage: `linear-gradient(to bottom,
                      transparent 0%,
                      transparent 23%,
                      rgba(255, 255, 255, 0.4) 40%,
                      rgba(255, 255, 255, 0.4) 60%,
                      transparent 77%,
                      transparent 100%)`,
              }
            : {
                  backgroundImage: `linear-gradient(to right,
                      transparent 0%,
                      transparent 23%,
                      rgba(255, 255, 255, 0.4) 40%,
                      rgba(255, 255, 255, 0.4) 60%,
                      transparent 77%,
                      transparent 100%)`,
              };

    return (
        <div
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation={orientation}
            style={orientation === "vertical" ? { width: panelGap } : { height: panelGap }}
            className={cn(
                `group relative flex shrink-0 items-center justify-center ${
                    orientation === "vertical"
                        ? "h-full cursor-col-resize"
                        : "w-full cursor-row-resize"
                }`,
                className,
            )}>
            <div
                style={{ ...lineStyle, opacity: isDragging ? 1 : undefined }}
                className={cn(
                    "pointer-events-none absolute transition-opacity duration-500 ease-out",
                    orientation === "vertical"
                        ? cn("inset-y-0 w-px", {
                              "left-1/2 -translate-x-1/2": align === "center",
                              "left-0": align === "start",
                              "right-0": align === "end",
                          })
                        : cn("inset-x-0 h-px", {
                              "top-1/2 -translate-y-1/2": align === "center",
                              "top-0": align === "start",
                              "bottom-0": align === "end",
                          }),
                    isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
            />
        </div>
    );
}

export { ResizeHandle };
