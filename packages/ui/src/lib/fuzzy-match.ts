interface FuzzyMatchResult {
    score: number;
    indices: number[];
}

const WORD_CHAR = /[a-z0-9]/i;

/**
 * Case-insensitive greedy subsequence match.
 *
 * Scoring: +1 per matched char, +4 when the match continues the previous
 * one (consecutive), +3 when it lands on a word start (string start or
 * preceded by a non-alphanumeric char). The total is scaled by 100 and the
 * candidate length subtracted so shorter candidates win ties.
 *
 * Greedy matching is not guaranteed to find the highest-scoring alignment;
 * that's an accepted trade-off for the small lists the palette filters.
 *
 * Returns null when `query` is not a subsequence of `text`.
 */
function fuzzyMatch(query: string, text: string): FuzzyMatchResult | null {
    if (query.length === 0) return { score: 0, indices: [] };

    const q = query.toLowerCase();
    const indices: number[] = [];
    let score = 0;
    let searchFrom = 0;

    for (const char of q) {
        // Compare code unit by code unit against the original text so the
        // returned indices stay aligned with it even when toLowerCase()
        // changes a character's code-unit length (e.g. "İ").
        let idx = -1;
        for (let i = searchFrom; i < text.length; i++) {
            if (text[i].toLowerCase() === char) {
                idx = i;
                break;
            }
        }
        if (idx === -1) return null;

        let charScore = 1;
        if (indices.length > 0 && idx === indices[indices.length - 1] + 1) {
            charScore += 4;
        }
        if (idx === 0 || !WORD_CHAR.test(text[idx - 1])) {
            charScore += 3;
        }

        score += charScore;
        indices.push(idx);
        searchFrom = idx + 1;
    }

    return { score: score * 100 - text.length, indices };
}

// FuzzyMatchResult is intentionally not exported — nothing consumes it yet
// (project rule: don't export until necessary).
export { fuzzyMatch };
