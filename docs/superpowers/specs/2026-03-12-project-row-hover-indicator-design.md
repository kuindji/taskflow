# Project Row Hover Indicator

## Problem

Project rows in the sidebar task list look like plain section headers. It's not obvious that clicking a project navigates to its own dedicated view (with git changes tab, commit/push, diff stats).

## Solution

On hover, the diff stats (+42 / -15) fade out and a right-arrow icon fades in at the same position, colored in the accent blue. This signals "click to open project view" without adding permanent visual weight.

## Behavior

| State | Diff Stats | Arrow |
|-------|-----------|-------|
| Default (has diff) | Visible | Hidden |
| Default (no diff) | N/A | Hidden |
| Hover (has diff) | Fades out (opacity-0) | Fades in (opacity-100, accent color) |
| Hover (no diff) | N/A | Fades in (opacity-100, accent color) |
| Active + hover | Same as hover | Same as hover |

## Implementation

Single file change: `packages/ui/src/components/sidebar/ProjectGroup.tsx`

1. Wrap the diff stats and arrow in a shared relative container on the right side of the project row
2. Diff stats get `transition-opacity group-hover:opacity-0`
3. Add `ArrowRight` icon (lucide-react, already in the project) with `absolute opacity-0 group-hover:opacity-100 transition-opacity text-accent`
4. Both elements overlap in the same space via absolute positioning
5. When there are no diff stats, the arrow still appears on hover in that right-side area

No new dependencies. No new components. ~10 lines changed.
