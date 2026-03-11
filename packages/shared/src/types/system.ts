export interface EditorInfo {
    id: string;
    name: string;
    command: string;
}

export interface SystemInfo {
    editors: EditorInfo[];
}
