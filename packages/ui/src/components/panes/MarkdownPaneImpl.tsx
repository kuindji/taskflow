import {
    Children,
    useEffect,
    useLayoutEffect,
    useMemo,
    useState,
    useCallback,
    useRef,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import GithubSlugger from "github-slugger";
import type { Components } from "react-markdown";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent } from "@/hooks/useWebSocket";
import { resolveLinkTarget } from "@/lib/markdown/link-target";
import { FrontmatterHeader } from "@/components/panes/markdown/FrontmatterHeader";
import { CodeBlock } from "@/components/panes/markdown/CodeBlock";
import { MermaidBlock } from "@/components/panes/markdown/MermaidBlock";
import { toggleTaskListItemAtLine, relocateTaskLine } from "@/lib/markdown/task-list";
import { rehypeTaskListLine } from "@/lib/markdown/rehype-task-list-line";
import { rawFileUrl } from "@/lib/backend-url";
import { openFileInApp } from "@/lib/open-file";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import {
    MSG,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_MARKDOWN_WIDTH,
    markdownWidthCss,
    dirnameOf,
    joinRelative,
    parseFrontmatter,
} from "@taskflow/shared";
import type { FileChangeEvent } from "@taskflow/shared";

interface MarkdownPaneImplProps {
    filePath: string;
    tabId: string;
    workspaceKey: string;
}

const remarkPlugins = [remarkGfm, remarkFrontmatter, remarkMath];
const rehypePlugins = [rehypeSlug, rehypeTaskListLine, rehypeKatex];

/**
 * Pending "#heading" for a page about to be navigated to. Keyed per pane as
 * well as per path: the same file can be open in two panes navigating to two
 * different fragments at once, and a path-only key would let whichever pane
 * loaded first consume — and delete — the other pane's target.
 */
const pendingHashes = new Map<string, string>();

function pendingHashKey(workspaceKey: string, tabId: string, filePath: string): string {
    return `${workspaceKey}\u0000${tabId}\u0000${filePath}`;
}

/**
 * Checkbox writes in flight, keyed by file path. A checkbox click is a
 * read-check-write over the whole file, and two panes can show the same file
 * (a split, or the same doc in two workspaces), so the queue has to be per
 * *file* rather than per pane: a per-pane queue still lets both panes read the
 * same pre-click bytes and lets the second write bury the first.
 */
const toggleChains = new Map<string, Promise<void>>();

function queueToggle(filePath: string, run: () => Promise<void>): void {
    const previous = toggleChains.get(filePath) ?? Promise.resolve();
    // `then(run, run)` — a rejected predecessor must not wedge the queue.
    const chain = previous.then(run, run).finally(() => {
        if (toggleChains.get(filePath) === chain) toggleChains.delete(filePath);
    });
    toggleChains.set(filePath, chain);
}

/**
 * Scroll to a heading. Tries the fragment verbatim first, then its slugged
 * form, because a hand-written `#Exchange Rates` (and, in Stage 2, a
 * `[[page#Exchange Rates]]`) must reach the id `rehype-slug` actually emitted.
 */
function scrollToHash(container: HTMLElement | null, hash: string): void {
    if (!container || hash === "") return;
    const slugged = new GithubSlugger().slug(hash);
    for (const candidate of [hash, slugged]) {
        const target = container.querySelector(`#${CSS.escape(candidate)}`);
        if (target) {
            target.scrollIntoView({ block: "start" });
            return;
        }
    }
}

function MarkdownPaneImpl({ filePath, tabId, workspaceKey }: MarkdownPaneImplProps) {
    const [content, setContent] = useState("");
    // The path `content` actually holds. `filePath` changes the moment the tab
    // navigates, well before the new file has been read, so effects that must
    // act on rendered content gate on this rather than on `filePath`/`loading`.
    const [loadedPath, setLoadedPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const workspace = useActiveWorkspace();
    const readFile = useFileStore((s) => s.readFile);
    const writeFile = useFileStore((s) => s.writeFile);
    const editorFontSize = useSettingsStore(
        (s) => s.settings?.editor?.fontSize ?? DEFAULT_EDITOR_FONT_SIZE,
    );
    const editorFontFamily = useSettingsStore(
        (s) => s.settings?.editor?.fontFamily ?? DEFAULT_EDITOR_FONT_FAMILY,
    );
    const markdownWidth = useSettingsStore(
        (s) => s.settings?.editor?.markdownWidth ?? DEFAULT_EDITOR_MARKDOWN_WIDTH,
    );
    const loadIdRef = useRef(0);
    // The path this pane is actually showing. A queued checkbox write closes
    // over the path it was clicked in, which the tab may have navigated away
    // from by the time the write runs; the write itself still belongs to the
    // old file, but nothing it learns may be pushed into this pane's state.
    const shownPathRef = useRef(filePath);
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollWriteRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Read imperatively, never subscribed: subscribing to the store would
    // re-render the pane on every scroll tick. `filePath` changes in place when
    // the tab navigates, so this is re-seeded for each page.
    const initialScrollTopRef = useRef(0);
    // Mirrors the container's scrollTop synchronously. React detaches DOM refs
    // in the mutation phase, before passive effect cleanup runs, so the unmount
    // flush below cannot read `scrollRef.current` — it reads this instead.
    const lastScrollTopRef = useRef(0);

    // Layout, not passive: layout effects run inside the commit, with no
    // microtask checkpoint between the DOM update and this line, so a queued
    // write's continuation can never observe the ref one navigation behind.
    useLayoutEffect(() => {
        shownPathRef.current = filePath;
    }, [filePath]);

    useEffect(() => {
        // Drop any throttled write still holding the previous page's offset;
        // navigation has already reset the tab's stored offset to 0.
        if (scrollWriteRef.current) {
            clearTimeout(scrollWriteRef.current);
            scrollWriteRef.current = null;
        }
        const stored =
            useSessionStore.getState().tabsByWorkspace[workspaceKey]?.find((t) => t.id === tabId)
                ?.previewScrollTop ?? 0;
        initialScrollTopRef.current = stored;
        // Seed the mirror too, so an unmount before the content finishes loading
        // re-writes the stored offset rather than clobbering it with 0.
        lastScrollTopRef.current = stored;
    }, [filePath, tabId, workspaceKey]);

    const handleScroll = useCallback(() => {
        const top = scrollRef.current?.scrollTop;
        if (top !== undefined) lastScrollTopRef.current = top;
        if (scrollWriteRef.current) return;
        scrollWriteRef.current = setTimeout(() => {
            scrollWriteRef.current = null;
            useSessionStore
                .getState()
                .setTabScrollTop(workspaceKey, tabId, lastScrollTopRef.current);
        }, 150);
    }, [tabId, workspaceKey]);

    // Flush the pending offset on unmount (the preview→edit swap unmounts this pane).
    useEffect(() => {
        return () => {
            if (scrollWriteRef.current) clearTimeout(scrollWriteRef.current);
            useSessionStore
                .getState()
                .setTabScrollTop(workspaceKey, tabId, lastScrollTopRef.current);
        };
    }, [tabId, workspaceKey]);

    const loadContent = useCallback(async () => {
        const loadId = ++loadIdRef.current;
        try {
            const text = await readFile(filePath);
            if (loadId !== loadIdRef.current) return;
            setContent(text);
            setLoadedPath(filePath);
            setError(null);
        } catch (err: unknown) {
            if (loadId !== loadIdRef.current) return;
            const message = err instanceof Error ? err.message : "Failed to read file";
            setError(message);
        } finally {
            if (loadId === loadIdRef.current) {
                setLoading(false);
            }
        }
    }, [filePath, readFile]);

    // Initial load
    useEffect(() => {
        setLoading(true);
        void loadContent();
    }, [loadContent]);

    // Track file changes
    useEffect(() => {
        return onEvent(MSG.FILE_CHANGED, (payload) => {
            const event = payload as FileChangeEvent;
            if (event.path === filePath && event.type !== "delete") {
                void loadContent();
            }
        });
    }, [filePath, loadContent]);

    // Restore once *this file's* content has rendered. Gating on `loadedPath`
    // rather than `loading` matters: on an in-tab navigation `filePath` changes
    // in the same commit that `loading` is still false from the previous file,
    // so a `loading`-gated effect would run against the outgoing document and
    // consume the pending fragment before the destination ever rendered.
    useEffect(() => {
        if (loadedPath !== filePath) return;
        const el = scrollRef.current;
        if (!el) return;
        const key = pendingHashKey(workspaceKey, tabId, filePath);
        const hash = pendingHashes.get(key);
        if (hash !== undefined) {
            pendingHashes.delete(key);
            scrollToHash(el, hash);
            return;
        }
        el.scrollTop = initialScrollTopRef.current;
        lastScrollTopRef.current = initialScrollTopRef.current;
    }, [filePath, loadedPath, tabId, workspaceKey]);

    const frontmatter = useMemo(() => parseFrontmatter(content), [content]);

    // Frontmatter targets are wiki-style page paths without an extension
    // ("business/money"). Until a wiki root exists (Stage 2) they are resolved
    // relative to the current file, which is correct for same-folder siblings
    // and harmless otherwise — a missing file simply fails to open.
    const handleFrontmatterNavigate = useCallback(
        (target: string) => {
            const withExt = /\.mdx?$|\.markdown$/i.test(target) ? target : `${target}.md`;
            const path = joinRelative(dirnameOf(filePath), withExt);
            useSessionStore.getState().navigateTab(workspaceKey, tabId, path);
        },
        [filePath, tabId, workspaceKey],
    );

    /**
     * Toggle a checkbox against the file on disk rather than against the
     * pane's `content` snapshot. Two panes hold independent snapshots and only
     * converge once the watcher's FILE_CHANGED event lands, so a
     * snapshot-based write silently reverts whatever the other pane changed
     * inside that window.
     *
     * A click made while the file was being rewritten under the pane is
     * dropped rather than re-applied, so a fast second click on the *same* box
     * can be swallowed — checked once instead of checked-then-unchecked. That
     * is the deliberate trade: a lost click is recoverable, a click applied to
     * the wrong item is not.
     */
    const toggleTaskLine = useCallback(
        (path: string, snapshot: string, line: number) => {
            queueToggle(path, async () => {
                const loadId = loadIdRef.current;
                // The write belongs to `path` — the document the clicked
                // checkbox was rendered from — which the tab may have
                // navigated away from since. That still makes it the right
                // file to write; it just makes this pane the wrong place to
                // put anything the write learns.
                const stillShown = () =>
                    shownPathRef.current === path && loadId === loadIdRef.current;
                let current: string;
                try {
                    current = await readFile(path);
                } catch {
                    if (stillShown()) void loadContent();
                    return;
                }
                const target =
                    current === snapshot ? line : relocateTaskLine(snapshot, current, line);
                if (target === null) {
                    // The item moved or was already toggled by someone else.
                    // Show what is on disk and drop the click.
                    if (stillShown()) setContent(current);
                    return;
                }
                const next = toggleTaskListItemAtLine(current, target);
                if (next === current) return;
                if (stillShown()) setContent(next);
                try {
                    await writeFile(path, next);
                } catch {
                    if (stillShown()) void loadContent();
                }
            });
        },
        [loadContent, readFile, writeFile],
    );

    const handleClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target instanceof HTMLInputElement && target.type === "checkbox") {
                const item = target.closest<HTMLElement>("li[data-source-line]");
                const line = Number(item?.dataset.sourceLine);
                if (!Number.isFinite(line)) return;
                // `loadedPath`, not `filePath`: what was clicked is what
                // `content` was rendered from, and for the moment between a
                // navigation commit and the new file's load those differ.
                if (loadedPath === null) return;
                toggleTaskLine(loadedPath, content, line);
                return;
            }

            const anchor = target.closest("a");
            if (!anchor) return;
            const href = anchor.getAttribute("href");
            if (href === null) return;

            // Nothing in a markdown preview should ever navigate the webview itself.
            event.preventDefault();
            const action = resolveLinkTarget(href, filePath);

            switch (action.kind) {
                case "anchor":
                    scrollToHash(scrollRef.current, action.hash);
                    break;
                case "markdown":
                    // An explicit self-link ("./doc.md#target" from doc.md) is
                    // just an anchor: `navigateTab` is a no-op for the path
                    // already shown, so nothing would re-run to consume a
                    // pending hash. Scroll here instead.
                    if (action.path === filePath) {
                        if (action.hash !== undefined) {
                            scrollToHash(scrollRef.current, action.hash);
                        }
                        break;
                    }
                    // Record before navigating: `navigateTab` synchronously
                    // re-renders this pane with the new path.
                    if (action.hash !== undefined) {
                        pendingHashes.set(
                            pendingHashKey(workspaceKey, tabId, action.path),
                            action.hash,
                        );
                    }
                    useSessionStore.getState().navigateTab(workspaceKey, tabId, action.path);
                    break;
                case "file": {
                    const owner =
                        workspace.scope === "task"
                            ? { taskId: workspace.task.id }
                            : workspace.scope === "project"
                              ? { projectId: workspace.project.id }
                              : undefined;
                    void openFileInApp(action.path, workspaceKey, owner);
                    break;
                }
                case "external":
                    void window.taskflow?.openExternalUrl(action.url);
                    break;
                case "ignore":
                    break;
            }
        },
        [content, filePath, loadedPath, tabId, toggleTaskLine, workspace, workspaceKey],
    );

    // Closes over `filePath`, which changes in place when the tab navigates.
    const components: Components = useMemo(
        () => ({
            code({ className, children, ...rest }) {
                const match = /language-(\w+)/.exec(className ?? "");
                const codeString = Children.toArray(children)
                    .map((child) => {
                        if (typeof child === "string" || typeof child === "number") {
                            return String(child);
                        }

                        return "";
                    })
                    .join("")
                    .replace(/\n$/, "");

                if (match?.[1] === "mermaid") {
                    return <MermaidBlock code={codeString} />;
                }

                if (match) {
                    return (
                        <CodeBlock
                            code={codeString}
                            language={match[1]}
                            fontSize={editorFontSize}
                        />
                    );
                }

                return (
                    <code className={className} {...rest}>
                        {children}
                    </code>
                );
            },
            input({ ...rest }) {
                if (rest.type === "checkbox") {
                    return <input {...rest} disabled={false} readOnly />;
                }
                return <input {...rest} />;
            },
            img({ src, alt, ...rest }) {
                const source = typeof src === "string" ? src : "";
                if (source === "" || /^(https?:|data:)/i.test(source)) {
                    return <img src={source} alt={alt ?? ""} {...rest} />;
                }
                const absolute = joinRelative(dirnameOf(filePath), source);
                const url = rawFileUrl(absolute);
                if (url === null) return <img alt={alt ?? ""} {...rest} />;
                return <img src={url} alt={alt ?? ""} {...rest} />;
            },
        }),
        [editorFontSize, filePath],
    );

    if (loading) {
        return (
            <div className="text-muted-foreground flex flex-1 items-center justify-center">
                Loading...
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-destructive flex flex-1 items-center justify-center">{error}</div>
        );
    }

    return (
        <div
            ref={scrollRef}
            onScroll={handleScroll}
            onClick={handleClick}
            className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
            <div
                className="markdown-preview prose prose-invert min-w-0"
                style={{
                    fontSize: editorFontSize,
                    fontFamily: editorFontFamily,
                    ["--markdown-measure" as string]: markdownWidthCss(markdownWidth),
                }}>
                {frontmatter && (
                    <FrontmatterHeader
                        frontmatter={frontmatter}
                        onNavigate={handleFrontmatterNavigate}
                    />
                )}
                <Markdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={components}>
                    {content}
                </Markdown>
            </div>
        </div>
    );
}

export default MarkdownPaneImpl;
