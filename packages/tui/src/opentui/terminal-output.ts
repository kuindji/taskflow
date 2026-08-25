const OSC1_PREFIX = "\x1b]1;";

function partialPrefixAtEnd(value: string): string {
    const limit = Math.min(value.length, OSC1_PREFIX.length - 1);
    for (let length = limit; length > 0; length -= 1) {
        const suffix = value.slice(-length);
        if (OSC1_PREFIX.startsWith(suffix)) return suffix;
    }
    return "";
}

/**
 * OpenTUI 0.5.7 logs ignored OSC 1 sequences through the host console. That
 * output bypasses the renderer and corrupts the alternate-screen frame.
 */
class EmbeddedTerminalOutputFilter {
    private prefix = "";
    private discardingOsc1 = false;
    private sawEscape = false;

    feed(chunk: string): string {
        let output = "";

        for (const character of chunk) {
            if (this.discardingOsc1) {
                if (character === "\x07" || (this.sawEscape && character === "\\")) {
                    this.discardingOsc1 = false;
                    this.sawEscape = false;
                    continue;
                }
                this.sawEscape = character === "\x1b";
                continue;
            }

            const candidate = this.prefix + character;
            if (this.prefix !== "" || character === "\x1b") {
                if (OSC1_PREFIX.startsWith(candidate)) {
                    if (candidate === OSC1_PREFIX) {
                        this.prefix = "";
                        this.discardingOsc1 = true;
                    } else {
                        this.prefix = candidate;
                    }
                    continue;
                }

                const partial = partialPrefixAtEnd(candidate);
                output += candidate.slice(0, candidate.length - partial.length);
                this.prefix = partial;
                continue;
            }

            output += character;
        }

        return output;
    }

    reset(): void {
        this.prefix = "";
        this.discardingOsc1 = false;
        this.sawEscape = false;
    }
}

export { EmbeddedTerminalOutputFilter };
