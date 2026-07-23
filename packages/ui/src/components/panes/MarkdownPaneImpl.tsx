import { Children, useEffect, useMemo, useState, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import type { Components } from "react-markdown";
import { useFileStore } from "@/stores/file-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { onEvent } from "@/hooks/useWebSocket";
import { resolveLinkTarget } from "@/lib/markdown/link-target";
import { dirnameOf, joinRelative } from "@/lib/markdown/paths";
import { parseFrontmatter } from "@/lib/markdown/frontmatter";
import { FrontmatterHeader } from "@/components/panes/markdown/FrontmatterHeader";
import { CodeBlock } from "@/components/panes/markdown/CodeBlock";
import { toggleTaskListItemAtLine } from "@/lib/markdown/task-list";
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
} from "@taskflow/shared";
import type { FileChangeEvent } from "@taskflow/shared";

interface MarkdownPaneImplProps {
    filePath: string;
    tabId: string;
    workspaceKey: string;
}

const remarkPlugins = [remarkGfm, remarkFrontmatter];
const rehypePlugins = [rehypeSlug, rehypeTaskListLine];

/** Pending "#heading" for a page about to be navigated to in this tab. */
const pendingHashes = new Map<string, string>();

function setPendingHash(filePath: string, hash: string): void {
    pendingHashes.set(filePath, hash);
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

    // Restore once the content has rendered and the container has a scroll height.
    useEffect(() => {
        if (loading) return;
        const el = scrollRef.current;
        if (!el) return;
        const hash = pendingHashes.get(filePath);
        if (hash !== undefined) {
            pendingHashes.delete(filePath);
            scrollToHash(el, hash);
            return;
        }
        el.scrollTop = initialScrollTopRef.current;
        lastScrollTopRef.current = initialScrollTopRef.current;
    }, [filePath, loading]);

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

    const handleClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target instanceof HTMLInputElement && target.type === "checkbox") {
                const item = target.closest<HTMLElement>("li[data-source-line]");
                const line = Number(item?.dataset.sourceLine);
                if (!Number.isFinite(line)) return;
                const next = toggleTaskListItemAtLine(content, line);
                if (next === content) return;
                setContent(next);
                void writeFile(filePath, next).catch(() => {
                    // The FILE_CHANGED subscription reloads from disk on failure.
                    void loadContent();
                });
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
                    useSessionStore.getState().navigateTab(workspaceKey, tabId, action.path);
                    if (action.hash !== undefined) setPendingHash(action.path, action.hash);
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
        [content, filePath, loadContent, tabId, workspace, workspaceKey, writeFile],
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
