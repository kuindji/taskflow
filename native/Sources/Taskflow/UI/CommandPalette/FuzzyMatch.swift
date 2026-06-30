import Foundation

/// Result of a fuzzy match: the relevance `score` (higher = better) and the matched character
/// `indices` into the ORIGINAL (non-lowercased) candidate string, used to bold matched chars.
/// Ports the return type of `packages/ui/src/lib/fuzzy-match.ts`.
struct FuzzyResult: Equatable {
    let score: Int
    let indices: [Int]
}

/// Case-insensitive greedy subsequence fuzzy matcher.
/// 1:1 port of `fuzzyMatch` in `packages/ui/src/lib/fuzzy-match.ts`.
enum FuzzyMatch {
    /// Returns `nil` when `query` is not a subsequence of `text`. Empty `query` always matches
    /// (score `-text.count`, no indices). Scoring: +1 base per matched char, +4 when the match is
    /// consecutive with the previous match, +3 when the match is at a word start; final score is
    /// `rawScore * 100 - text.count` so shorter candidates win ties.
    nonisolated static func match(_ query: String, _ text: String) -> FuzzyResult? {
        let textChars = Array(text)
        let lowerText = Array(text.lowercased())
        let lowerQuery = Array(query.lowercased())

        var indices: [Int] = []
        var rawScore = 0
        var searchFrom = 0

        for qChar in lowerQuery {
            var found = -1
            var i = searchFrom
            while i < lowerText.count {
                if lowerText[i] == qChar { found = i; break }
                i += 1
            }
            if found == -1 { return nil }

            var charScore = 1
            if let last = indices.last, found == last + 1 { charScore += 4 }      // consecutive run
            if found == 0 || !isWordChar(lowerText[found - 1]) { charScore += 3 }  // word start
            rawScore += charScore
            indices.append(found)
            searchFrom = found + 1
        }

        _ = textChars   // indices index into the original string; lengths match lowerText.
        return FuzzyResult(score: rawScore * 100 - text.count, indices: indices)
    }

    /// `[a-z0-9]` test on an already-lowercased character (matches the TS `WORD_CHAR` regex).
    private nonisolated static func isWordChar(_ c: Character) -> Bool {
        c.isLetter || c.isNumber
    }
}
