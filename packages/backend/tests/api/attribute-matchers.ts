import { expect } from "bun:test";
import type { ResolvedAttribute } from "@taskflow/shared";

// bun:test types `expect.objectContaining` as `AsymmetricMatcher = any`, which
// would otherwise leak an `any` into the `toEqual` argument arrays at every
// call site and trip `@typescript-eslint/no-unsafe-argument`. Assert the
// intended shape once here instead.
function matchesAttribute(match: Partial<ResolvedAttribute>): ResolvedAttribute {
    return expect.objectContaining(match) as ResolvedAttribute;
}

export { matchesAttribute };
