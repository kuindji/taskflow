export interface EditorInfo {
    id: string;
    name: string;
    command: string;
    type: "internal" | "external";
    /** Format string for line navigation. Uses {line} and {file} placeholders.
     *  e.g. "+{line}" (vim-style) or "{file}:{line}" (helix-style).
     *  When lineFlag contains {file}, the file path is embedded in the flag
     *  and must NOT be passed as a separate argument. */
    lineFlag?: string;
    /** Extra args always passed, e.g. ["-nw"] for emacs */
    extraArgs?: string[];
}

export interface SystemInfo {
    editors: EditorInfo[];
}
