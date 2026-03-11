import { useCallback, useRef } from "react";

interface ResizeHandleProps {
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
    panelGap: number;
}

function ResizeHandle({ onResize, onResizeEnd, panelGap }: ResizeHandleProps) {
    const startXRef = useRef(0);
    const isDraggingRef = useRef(false);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            startXRef.current = e.clientX;
            isDraggingRef.current = true;

            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (!isDraggingRef.current) return;
                const delta = moveEvent.clientX - startXRef.current;
                startXRef.current = moveEvent.clientX;
                onResize(delta);
            };

            const handleMouseUp = () => {
                isDraggingRef.current = false;
                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
                onResizeEnd?.();
            };

            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        },
        [onResize, onResizeEnd],
    );

    const width = Math.max(panelGap, 8);

    return (
        <div
            onMouseDown={handleMouseDown}
            style={{ width }}
            className="group relative flex shrink-0 cursor-col-resize items-center justify-center"
        >
            <div className="bg-border/40 group-hover:bg-border/70 h-8 w-0.5 rounded-full transition-colors" />
        </div>
    );
}

export { ResizeHandle };
