export interface WikiHeading {
    depth: number;
    text: string;
    id: string;
}

export interface WikiPage {
    /** Path relative to the wiki root, without the extension. The page id. */
    id: string;
    /** Path relative to the wiki root, with the extension. */
    path: string;
    title: string;
    parents: string[];
    children: string[];
    relatedPages: string[];
    lastUpdated?: string;
    headings: WikiHeading[];
    /** Page ids this page links to, deduplicated, in first-appearance order. */
    links: string[];
    /** Link targets that did not resolve to a page id. */
    brokenLinks: string[];
    mtimeMs: number;
}

export interface WikiTreeNode {
    name: string;
    type: "page" | "folder";
    /** Page id — present on pages, and on folders that have an index page. */
    id?: string;
    children?: WikiTreeNode[];
}

export interface WikiUnresolvedLink {
    from: string;
    target: string;
}

export interface WikiIndexData {
    root: string;
    /**
     * False when the `wiki` attribute points at a path that is missing or is
     * not a directory. The UI shows a warning; it is never an error.
     */
    rootExists: boolean;
    pages: WikiPage[];
    tree: WikiTreeNode[];
    /** page id → ids of pages linking to it */
    backlinks: Record<string, string[]>;
    unresolved: WikiUnresolvedLink[];
    /** Page ids with no incoming links and no declared parent. */
    orphans: string[];
}

export type ObsidianVaultState = "registered" | "unregistered-vault" | "plain-folder";

export interface ObsidianState {
    installed: boolean;
    /** null when Obsidian is not installed or no wiki root was given. */
    vault: ObsidianVaultState | null;
}
