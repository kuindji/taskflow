import { lazy, Suspense, type ComponentType } from "react";
import type { GitFileContentPair } from "@taskflow/shared";

const MonacoTextView = lazy(async () => ({
    default: (await import("./MonacoDiffViewer")).MonacoDiffViewer,
}));

function DiffPreview({
    pair,
    language,
    TextView = MonacoTextView,
}: {
    pair: GitFileContentPair;
    language: string;
    TextView?: ComponentType<{ original: string; modified: string; language: string }>;
}) {
    if (pair.state) {
        const message =
            pair.state === "binary"
                ? "Binary file"
                : pair.limit === "diff"
                  ? "Diff exceeds 1 MiB"
                  : "File preview exceeds 5 MiB";
        return <div className="text-muted-foreground p-3 text-sm">{message}</div>;
    }
    return (
        <Suspense
            fallback={<div className="text-muted-foreground p-3 text-sm">Loading diff...</div>}>
            <TextView original={pair.original} modified={pair.modified} language={language} />
        </Suspense>
    );
}
export { DiffPreview };
