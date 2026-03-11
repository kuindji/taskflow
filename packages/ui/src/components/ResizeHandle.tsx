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

    const width = Math.max(panelGap, 4);

    return (
        <div
            onMouseDown={handleMouseDown}
            style={{ width }}
            className="group relative shrink-0 cursor-col-resize"
        >
            <div className="bg-border group-hover:bg-ring absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-all group-hover:w-[2px]" />
        </div>
    );
}

export { ResizeHandle };
