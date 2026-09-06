/**
 * Turns a drag from another application into the fields of a new task.
 *
 * Two levels of fidelity. Anything carrying text becomes a description, which is
 * what makes a paragraph dragged out of a chat window or an editor useful. A
 * drag from TaskTray additionally carries a `tasktray://task/<id>` URL, which is
 * both the provenance marker and, in its query string, an exact title and
 * description — TaskTray already knows them and there is no reason to make the
 * user retype what it knows.
 */

interface DroppedTask {
    title?: string;
    description: string;
}

/** Structurally typed rather than a `DataTransfer`, so tests can pass an object. */
type DropData = Pick<DataTransfer, "getData" | "types">;

const TASK_URL_PREFIX = "tasktray://task/";
const TEXT_TYPES = ["text/plain", "text/uri-list", "text/html"];

function acceptsDrop(types: readonly string[]): boolean {
    return TEXT_TYPES.some((type) => types.includes(type));
}

function read(data: DropData, type: string): string {
    if (!data.types.includes(type)) return "";
    return lineFeeds(data.getData(type) ?? "");
}

/** CRLF folded to LF, so a blank-line search cannot miss `\r\n\r\n`. */
function lineFeeds(value: string): string {
    return value.replace(/\r\n?/g, "\n");
}

function singleLine(value: string): string {
    return value.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * The first `tasktray://task/...` line in a uri-list or in the body.
 *
 * A uri-list is newline separated and may carry `#` comments, and the marker can
 * also arrive as a trailing line of the plain text when the sending side had to
 * put provenance inside the body.
 */
function findTaskUrl(text: string): string | null {
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith(TASK_URL_PREFIX)) return trimmed;
    }
    return null;
}

/**
 * The exact split, when TaskTray put one in the query.
 *
 * Null when the URL carries no fields, which is the shape where the marker is
 * only provenance and the text body holds the content.
 */
function fromTaskUrl(url: string): DroppedTask | null {
    let params: URLSearchParams;
    try {
        params = new URL(url).searchParams;
    } catch {
        // Belt and braces on untrusted input, not a path with a test behind it:
        // `findTaskUrl` has already fixed the scheme and the host, and the
        // WHATWG parser accepts anything after those — a `%%%` path or an
        // unterminated escape comes back as a literal rather than throwing.
        return null;
    }
    const title = params.get("title")?.trim() ?? "";
    const description = params.get("description")?.trim() ?? "";
    // Empty fields are the marker-only shape wearing a query string; let the
    // caller read the body instead of returning a task with nothing in it.
    if (!title && !description) return null;
    return { ...(title ? { title: singleLine(title) } : {}), description };
}

/**
 * "First line, blank line, the rest" — the convention TaskTray's plain-text
 * flavour is written to.
 *
 * This is the JavaScript half of `TaskDragPayload.parse` in TaskTray's Core;
 * `TaskDragPayloadTests.testParseIsTheInverseOfBuild` is the executable
 * definition both sides are held to.
 */
function splitAtBlankLine(text: string): DroppedTask {
    const separator = text.indexOf("\n\n");
    if (separator < 0) return { title: singleLine(text), description: "" };
    return {
        title: singleLine(text.slice(0, separator)),
        description: text.slice(separator + 2).trim(),
    };
}

/** The anchor a browser puts on the pasteboard when a card or link is dragged. */
function fromAnchor(html: string, plain: string): DroppedTask | null {
    if (!html || typeof DOMParser === "undefined") return null;
    let anchor: HTMLAnchorElement | null;
    try {
        anchor = new DOMParser().parseFromString(html, "text/html").querySelector("a[href]");
    } catch {
        return null;
    }
    const href = anchor?.getAttribute("href")?.trim();
    if (!href) return null;
    const title = singleLine(anchor?.textContent ?? "");
    if (!title) return null;
    // A link drag puts the URL in the plain text too, so keeping both would say
    // the same thing twice.
    const body = plain.trim();
    return { title, description: body && body !== href ? `${body}\n\n${href}` : href };
}

/**
 * Null only when the drag carries no text at all, so the caller can decline it.
 */
function parseDroppedTask(data: DropData): DroppedTask | null {
    const plain = read(data, "text/plain");
    const uriList = read(data, "text/uri-list");

    const taskUrl = findTaskUrl(uriList) ?? findTaskUrl(plain);
    if (taskUrl) {
        // Accepting both shapes on purpose: it lets TaskTray move the content
        // between the query string and the text body without a change here.
        const fromQuery = fromTaskUrl(taskUrl);
        if (fromQuery) return fromQuery;
        const body = plain
            .split("\n")
            .filter((line) => line.trim() !== taskUrl)
            .join("\n")
            .trim();
        if (body) return splitAtBlankLine(body);
    }

    const fromLink = fromAnchor(read(data, "text/html"), plain);
    if (fromLink) return fromLink;

    const body = plain.trim() || uriList.trim();
    return body ? { description: body } : null;
}

export { acceptsDrop, parseDroppedTask };
export type { DroppedTask };
