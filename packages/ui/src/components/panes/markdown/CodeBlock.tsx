import { useCallback, useState } from "react";
import { Check, Copy } from "lucide-react";
import { SyntaxHighlighter } from "@/components/panes/markdown/prism-highlighter";
import "@/styles/prism-one-dark.css";

interface CodeBlockProps {
    code: string;
    language: string;
    fontSize: number;
}

function CodeBlock({ code, language, fontSize }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }, [code]);

    return (
        <div className="group relative">
            <button
                type="button"
                onClick={handleCopy}
                aria-label={copied ? "Copied" : "Copy code"}
                className="border-border/60 bg-card text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-md border p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {/* Class-based tokens styled by prism-one-dark.css. Inline styles
                would rebuild a style object per token on every render. */}
            <SyntaxHighlighter
                useInlineStyles={false}
                language={language}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: "0.375rem", fontSize }}>
                {code}
            </SyntaxHighlighter>
        </div>
    );
}

export { CodeBlock };
