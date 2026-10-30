import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DiffPreview } from "./DiffPreview";

let container: HTMLDivElement;
let root: Root;
let constructed = 0;
function TextView({
    original,
    modified,
}: {
    original: string;
    modified: string;
    language: string;
}) {
    constructed++;
    return (
        <div>
            {original} / {modified}
        </div>
    );
}
beforeEach(() => {
    constructed = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
test("tooLarge renders Diff exceeds 1 MiB without constructing Monaco", async () => {
    await act(async () =>
        root.render(
            <DiffPreview
                pair={{ state: "tooLarge", limit: "diff" }}
                language="text"
                TextView={TextView}
            />,
        ),
    );
    expect(container.textContent).toBe("Diff exceeds 1 MiB");
    expect(constructed).toBe(0);
});
test("a preview cap renders File preview exceeds 5 MiB", async () => {
    await act(async () =>
        root.render(
            <DiffPreview
                pair={{ state: "tooLarge", limit: "preview" }}
                language="text"
                TextView={TextView}
            />,
        ),
    );
    expect(container.textContent).toBe("File preview exceeds 5 MiB");
    expect(constructed).toBe(0);
});
test("binary renders Binary file without constructing Monaco", async () => {
    await act(async () =>
        root.render(<DiffPreview pair={{ state: "binary" }} language="text" TextView={TextView} />),
    );
    expect(container.textContent).toBe("Binary file");
    expect(constructed).toBe(0);
});
test("text renders both complete sides", async () => {
    await act(async () =>
        root.render(
            <DiffPreview
                pair={{ original: "before", modified: "after" }}
                language="text"
                TextView={TextView}
            />,
        ),
    );
    expect(container.textContent).toBe("before / after");
    expect(constructed).toBeGreaterThan(0);
});
