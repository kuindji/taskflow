export interface FileNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileNode[];
    loaded?: boolean;
    gitStatus?: "new" | "modified" | "deleted" | "untracked" | "renamed" | null;
}

export interface FileChangeEvent {
    type: "create" | "modify" | "delete";
    path: string;
    /**
     * Set when many changes were collapsed into one event: `path` is a
     * directory and everything loaded under it should be refreshed.
     */
    recursive?: boolean;
}
