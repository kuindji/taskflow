export type PlistValue = PlistDict | PlistValue[] | Uint8Array | string | number | boolean | null;

export interface PlistDict {
    [key: string]: PlistValue;
}

interface Token {
    kind: "open" | "close" | "text";
    name?: string;
    selfClosing?: boolean;
    text?: string;
}

function tokenize(xml: string): Token[] {
    const tokens: Token[] = [];
    const parts = xml.match(/<[^>]+>|[^<]+/g) ?? [];

    for (const part of parts) {
        if (part.startsWith("<?") || part.startsWith("<!") || part.startsWith("<!--")) {
            continue;
        }

        if (part.startsWith("</")) {
            const name = /^<\/([^\s>]+)>$/.exec(part)?.[1];
            if (name) {
                tokens.push({ kind: "close", name });
            }
            continue;
        }

        if (part.startsWith("<")) {
            const name = /^<([^\s/>]+)[^>]*?(\/)?>$/.exec(part)?.[1];
            const selfClosing = part.endsWith("/>");
            if (name) {
                tokens.push({ kind: "open", name, selfClosing });
            }
            continue;
        }

        tokens.push({ kind: "text", text: part });
    }

    return tokens;
}

export function isPlistDict(value: PlistValue): value is PlistDict {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Uint8Array)
    );
}

export function parsePlistXml(xml: string): PlistValue | null {
    const tokens = tokenize(xml);
    let index = 0;

    function peek(): Token | undefined {
        return tokens[index];
    }

    function consume(): Token | undefined {
        const token = tokens[index];
        index += 1;
        return token;
    }

    function skipWhitespaceText(): void {
        while (peek()?.kind === "text" && !(peek()?.text ?? "").trim()) {
            index += 1;
        }
    }

    function consumeCloseTag(name: string): boolean {
        skipWhitespaceText();
        const token = peek();
        if (token?.kind === "close" && token.name === name) {
            index += 1;
            return true;
        }
        return false;
    }

    function collectTextUntilClose(name: string): string {
        let value = "";

        while (index < tokens.length) {
            const token = consume();
            if (!token) break;

            if (token.kind === "close" && token.name === name) {
                return value;
            }

            if (token.kind === "text") {
                value += token.text ?? "";
            }
        }

        return value;
    }

    function parseValue(): PlistValue {
        skipWhitespaceText();
        const token = consume();
        if (!token || token.kind !== "open" || !token.name) {
            return null;
        }

        switch (token.name) {
            case "plist": {
                const root = parseValue();
                consumeCloseTag("plist");
                return root;
            }
            case "dict": {
                const dict: PlistDict = {};

                while (!consumeCloseTag("dict") && index < tokens.length) {
                    const key = parseValue();
                    if (typeof key !== "string") {
                        return null;
                    }
                    const value = parseValue();
                    dict[key] = value;
                }

                return dict;
            }
            case "array": {
                const values: PlistValue[] = [];

                while (!consumeCloseTag("array") && index < tokens.length) {
                    values.push(parseValue());
                }

                return values;
            }
            case "key":
            case "string":
            case "date":
                return token.selfClosing ? "" : collectTextUntilClose(token.name);
            case "integer": {
                const text = token.selfClosing ? "" : collectTextUntilClose("integer");
                const value = Number.parseInt(text.trim(), 10);
                return Number.isNaN(value) ? null : value;
            }
            case "real": {
                const text = token.selfClosing ? "" : collectTextUntilClose("real");
                const value = Number.parseFloat(text.trim());
                return Number.isNaN(value) ? null : value;
            }
            case "data": {
                const text = token.selfClosing ? "" : collectTextUntilClose("data");
                const normalized = text.replace(/\s+/g, "");
                return Uint8Array.from(Buffer.from(normalized, "base64"));
            }
            case "true":
                consumeCloseTag("true");
                return true;
            case "false":
                consumeCloseTag("false");
                return false;
            default:
                if (!token.selfClosing) {
                    collectTextUntilClose(token.name);
                }
                return null;
        }
    }

    return parseValue();
}
