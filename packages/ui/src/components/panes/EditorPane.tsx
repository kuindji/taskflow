import { Suspense, lazy } from "react";

interface EditorPaneProps {
    filePath: string;
}

const LazyEditorPane = lazy(() => import("./EditorPaneImpl"));

function EditorPane({ filePath }: EditorPaneProps) {
    return (
        <Suspense
            fallback={
                <div className="text-muted-foreground flex flex-1 items-center justify-center">
                    Loading editor...
                </div>
            }
        >
            <LazyEditorPane filePath={filePath} />
        </Suspense>
    );
}

export { EditorPane };
