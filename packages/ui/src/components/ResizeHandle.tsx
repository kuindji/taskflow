import { useCallback, useRef, useState } from "react";

interface ResizeHandleProps {
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    panelGap: number;
    orientation?: "vertical" | "horizontal";
}

function ResizeHandle({
    onResize,
    onResizeEnd,
    panelGap,
    orientation = "vertical",
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
                      transparent 33%,
                      color-mix(in srgb, var(--accent) 72%, transparent) 40%,
                      color-mix(in srgb, var(--accent) 72%, transparent) 60%,
                      transparent 67%,
                      transparent 100%)`,
              }
            : {
                  backgroundImage: `linear-gradient(to right,
                      transparent 0%,
                      transparent 33%,
                      color-mix(in srgb, var(--accent) 72%, transparent) 40%,
                      color-mix(in srgb, var(--accent) 72%, transparent) 60%,
                      transparent 67%,
                      transparent 100%)`,
              };

    return (
        <div
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation={orientation}
            style={orientation === "vertical" ? { width: panelGap } : { height: panelGap }}
            className={`group relative flex shrink-0 items-center justify-center ${
                orientation === "vertical"
                    ? "h-full cursor-col-resize"
                    : "w-full cursor-row-resize"
            }`}
        >
            <div
                style={{ ...lineStyle, opacity: isDragging ? 1 : undefined }}
                className={`pointer-events-none absolute transition-opacity duration-200 ease-out ${
                    orientation === "vertical"
                        ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
                        : "inset-x-0 top-1/2 h-px -translate-y-1/2"
                } ${isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
            />
        </div>
    );
}

export { ResizeHandle };
