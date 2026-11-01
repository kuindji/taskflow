import { defaultUrlTransform } from "react-markdown";
import type { UrlTransform } from "react-markdown";
import { dirnameOf, joinRelative } from "@taskflow/shared";
import { isMarkdownPath } from "@/lib/open-file-plan";

/** What a click on a rendered markdown link should do. */
type LinkAction =
    | { kind: "anchor"; hash: string }
    | { kind: "markdown"; path: string; hash?: string }
    | { kind: "file"; path: string }
    | { kind: "external"; url: string }
    | { kind: "ignore" };

function resolveLinkTarget(href: string, currentFilePath: string): LinkAction {
    const trimmed = href.trim();
    if (trimmed === "" || trimmed === "#") return { kind: "ignore" };

    if (trimmed.startsWith("#")) {
        return { kind: "anchor", hash: decodeURIComponent(trimmed.slice(1)) };
    }

    if (/^https?:\/\//i.test(trimmed)) return { kind: "external", url: trimmed };

    // Any other scheme (javascript:, data:, mailto:, vscode:, ...) is not ours to
    // open. Two or more characters before the colon, so a Windows drive letter
    // ("C:/w/doc.md") is treated as a path rather than an unknown scheme.
    if (/^[a-z][a-z0-9+.-]+:/i.test(trimmed)) return { kind: "ignore" };

    const hashIndex = trimmed.indexOf("#");
    const rawPath = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
    const hash = hashIndex === -1 ? undefined : decodeURIComponent(trimmed.slice(hashIndex + 1));
    if (rawPath === "") return { kind: "ignore" };

    const path = joinRelative(dirnameOf(currentFilePath), rawPath);
    if (isMarkdownPath(path)) {
        return hash === undefined || hash === ""
            ? { kind: "markdown", path }
            : { kind: "markdown", path, hash };
    }
    return { kind: "file", path };
}

/**
 * react-markdown's URL sanitiser for the preview. The default one reads the
 * drive letter of "C:/w/doc.md" as an unknown scheme and blanks the href, so
 * every wiki link (an absolute path under the wiki root) and every explicit
 * drive-letter link would render dead on a Windows machine. A drive-letter
 * path is kept; everything else gets the default treatment.
 */
const markdownUrlTransform: UrlTransform = (url) =>
    /^[a-z]:[\\/]/i.test(url) ? url : defaultUrlTransform(url);

export type { LinkAction };
export { markdownUrlTransform, resolveLinkTarget };
