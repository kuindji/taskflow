import { expect, test, beforeEach, afterEach } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CodeBlock } from "./CodeBlock";

/**
 * Highlighting must be class-based. Per-token inline styles are what made a
 * plan doc with ~90 fenced blocks take ~3 s per render: the highlighter
 * merged a style object per token on every render, which was ~96% of the
 * pane's render time (tokenizing the same blocks takes ~27 ms).
 */

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(code: string, language: string) {
    act(() => {
        root.render(<CodeBlock code={code} language={language} fontSize={14} />);
    });
}

test("highlights tokens with class names, not per-token inline styles", () => {
    render("const x = 1;", "ts");
    const keyword = container.querySelector(".token.keyword");
    expect(keyword?.textContent).toBe("const");
    expect(keyword?.getAttribute("style")).toBeNull();
    expect(container.querySelectorAll(".token[style]").length).toBe(0);
});

test("resolves language aliases used in fences", () => {
    render("echo hi", "sh");
    expect(container.querySelector(".token.builtin, .token.function")?.textContent).toBe("echo");
});

test("renders an unknown language as plain code", () => {
    render("hello world", "nosuchlang");
    expect(container.querySelector("code")?.textContent).toBe("hello world");
});
