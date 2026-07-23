import { useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
    code: string;
}

let mermaidReady: Promise<typeof import("mermaid").default> | null = null;

/**
 * Load mermaid on first use only. The library is large and most pages contain
 * no diagrams, so it must never sit in the main chunk.
 */
function loadMermaid(): Promise<typeof import("mermaid").default> {
    mermaidReady ??= import("mermaid").then((module) => {
        module.default.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
        });
        return module.default;
    });
    return mermaidReady;
}

function MermaidBlock({ code }: MermaidBlockProps) {
    const reactId = useId();
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const renderIdRef = useRef(0);

    useEffect(() => {
        const renderId = ++renderIdRef.current;
        setError(null);
        void loadMermaid()
            .then((mermaid) =>
                mermaid.render(`mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, "")}`, code),
            )
            .then(({ svg: rendered }) => {
                if (renderId !== renderIdRef.current) return;
                setSvg(rendered);
            })
            .catch((err: unknown) => {
                if (renderId !== renderIdRef.current) return;
                setError(err instanceof Error ? err.message : "Failed to render diagram");
            });
    }, [code, reactId]);

    if (error !== null) {
        return (
            <pre className="border-destructive/40 text-destructive markdown-fullbleed overflow-x-auto rounded-md border p-3 text-xs">
                {error}
                {"\n\n"}
                {code}
            </pre>
        );
    }

    if (svg === null) {
        return <div className="text-muted-foreground p-3 text-xs">Rendering diagram…</div>;
    }

    // mermaid renders trusted-by-construction SVG from the document's own text
    // with securityLevel "strict" (no click handlers, HTML labels escaped).
    return (
        <div
            className="markdown-fullbleed my-4 flex justify-center"
            dangerouslySetInnerHTML={{ __html: svg }}
        />
    );
}

export { MermaidBlock };
