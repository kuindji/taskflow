export interface FileNode {
    name: string;
    path: string;
    type: "file" | "directory";
    children?: FileNode[];
    gitStatus?: "new" | "modified" | "deleted" | "untracked" | "renamed" | null;
}

export interface FileChangeEvent {
    type: "create" | "modify" | "delete";
    path: string;
}
