import { Suspense, lazy } from "react";

interface MarkdownPaneProps {
    filePath: string;
}

const LazyMarkdownPane = lazy(() => import("./MarkdownPaneImpl"));

function MarkdownPane({ filePath }: MarkdownPaneProps) {
    return (
        <Suspense
            fallback={
                <div className="text-muted-foreground flex flex-1 items-center justify-center">
                    Loading preview...
                </div>
            }>
            <LazyMarkdownPane filePath={filePath} />
        </Suspense>
    );
}

export { MarkdownPane };
