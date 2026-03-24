import type { IBufferLine, IBufferRange, Terminal } from "@xterm/xterm";

const MAX_LINK_WINDOW_CHARS = 2048;

interface WrappedLineWindow {
    startLineIndex: number;
    text: string;
}

type TerminalWithBuffer = Pick<Terminal, "buffer">;

/**
 * Reconstruct the wrapped logical line around a hovered buffer row.
 *
 * Expansion is intentionally bounded in the same way as xterm's web-links
 * addon: stop at whitespace boundaries or once the scanned text gets large.
 */
export function getWrappedLineWindow(
    term: TerminalWithBuffer,
    lineIndex: number,
): WrappedLineWindow | null {
    const buffer = term.buffer.active;
    let line: IBufferLine | undefined;
    let topIdx = lineIndex;
    let bottomIdx = lineIndex;
    let length: number;
    let content: string;
    const lines: string[] = [];

    if ((line = buffer.getLine(lineIndex))) {
        const currentContent = line.translateToString(true);

        if (line.isWrapped && currentContent[0] !== " ") {
            length = 0;
            while ((line = buffer.getLine(--topIdx)) && length < MAX_LINK_WINDOW_CHARS) {
                content = line.translateToString(true);
                length += content.length;
                lines.push(content);
                if (!line.isWrapped || content.indexOf(" ") !== -1) {
                    break;
                }
            }
            lines.reverse();
        }

        lines.push(currentContent);

        length = 0;
        while (
            (line = buffer.getLine(++bottomIdx)) &&
            line.isWrapped &&
            length < MAX_LINK_WINDOW_CHARS
        ) {
            content = line.translateToString(true);
            length += content.length;
            lines.push(content);
            if (content.indexOf(" ") !== -1) {
                break;
            }
        }
    }

    if (lines.length === 0) return null;
    return { startLineIndex: topIdx, text: lines.join("") };
}

/**
 * Map a string slice within a wrapped logical line back to xterm buffer coords.
 *
 * Range coordinates follow xterm's IBufferRange semantics and may span rows.
 */
export function getWrappedRangeForMatch(
    term: TerminalWithBuffer,
    startLineIndex: number,
    startStringIndex: number,
    textLength: number,
): IBufferRange | null {
    const [startY, startX] = mapStringIndexToBufferPosition(
        term,
        startLineIndex,
        0,
        startStringIndex,
    );
    const [endY, endX] = mapStringIndexToBufferPosition(term, startY, startX, textLength);

    if (startY === -1 || startX === -1 || endY === -1 || endX === -1) {
        return null;
    }

    return {
        start: {
            x: startX + 1,
            y: startY + 1,
        },
        end: {
            x: endX,
            y: endY + 1,
        },
    };
}

function mapStringIndexToBufferPosition(
    term: TerminalWithBuffer,
    lineIndex: number,
    rowIndex: number,
    stringIndex: number,
): [number, number] {
    const buffer = term.buffer.active;
    const cell = buffer.getNullCell();
    let start = rowIndex;

    while (stringIndex) {
        const line = buffer.getLine(lineIndex);
        if (!line) {
            return [-1, -1];
        }

        for (let i = start; i < line.length; ++i) {
            line.getCell(i, cell);
            const chars = cell.getChars();
            const width = cell.getWidth();
            if (width) {
                stringIndex -= chars.length || 1;

                // Match xterm's handling for wide chars that wrap early.
                if (i === line.length - 1 && chars === "") {
                    const nextLine = buffer.getLine(lineIndex + 1);
                    if (nextLine && nextLine.isWrapped) {
                        nextLine.getCell(0, cell);
                        if (cell.getWidth() === 2) {
                            stringIndex += 1;
                        }
                    }
                }
            }

            if (stringIndex < 0) {
                return [lineIndex, i];
            }
        }

        lineIndex++;
        start = 0;
    }

    return [lineIndex, start];
}
