# Dialog Redesign — Settings, Appearance, Flow Management

## Overview

Redesign the three main configuration dialogs (Settings, Appearance, Flow Management) to share a consistent, professional "island" layout pattern. The current dialogs suffer from inconsistent spacing, mixed control heights, border-separated panels that feel glued together, and varied label/field patterns across dialogs.

## Design Decisions

### Island Layout

All three dialogs use a shared chrome pattern:

- **Dialog shell**: `crust` background with `6px` inner padding and `14px` border-radius. This creates a subtle frame around the content.
- **Panels as islands**: Sidebar, content area, and list columns are separate rounded (`10px`) subpanels with `6px` gaps between them — no border lines dividing panels. The color difference and gap provide visual separation.
  - Sidebar: `mantle` background
  - Content area: `base` background
  - List column (Flows only): `mantle` background
  - Editor column (Flows only): `base` background
- **Header**: Sits in the `crust` area above the islands. Equal padding top and bottom (`14px 18px`). Title only — no subtitle/description text.

### Form Row Patterns

Two patterns depending on content complexity:

**Horizontal rows** (Settings, agent pages, Appearance/Fonts):
- Label + hint on the left, control on the right
- `13px 20px` padding per row, `6px` border-radius, `4px` horizontal margin
- Hover: subtle background highlight (`rgba(24, 24, 37, 0.4)`)
- No separator lines between rows — just the hover highlight defines boundaries

**Stacked fields** (Flow/Action editors):
- Label above, control below
- Uppercase `11px` labels with `0.6px` letter-spacing
- `16px` gap between field groups
- Used for text inputs, textareas, and compound sections with multiple controls

### Appearance Dialog Changes

**Tabs → Sidebar nav**: Replace the current `TabsList`/`TabsTrigger` approach with the same sidebar nav pattern used in Settings. This makes all three dialogs visually consistent. The three sections (Themes, Import, Fonts) become nav items.

**Fonts page**: Each font section (Application/Terminal/Editor) is a single group container. The section label (uppercase, `overlay0` color) and the family+size controls sit inside one hoverable block — not separate rows.

### Navigation Sidebar

All three dialogs share the same nav pattern:
- `148px` width, `6px` inner padding
- Items: `7px 12px` padding, `13px` font, `6px` border-radius
- Active: `surface0` background, `text` color, `font-weight: 500`
- Inactive: `overlay1` color, hover → `subtext1` with faint background
- No dot indicators or other decorations

### Form Controls

Standardize all controls to a consistent size:
- **Select triggers**: `6px 10px` padding, `13px` font, `mantle` background, `surface0` border, `180px` min-width (in horizontal rows)
- **Inputs**: Same dimensions as selects. Use the `Input` component everywhere (replace raw `<input>` in OpenCode settings)
- **Switches**: Existing `Switch` component, paired with a `13px` label showing "Enabled"/"Disabled"
- **Buttons (small)**: `4px 12px` padding, `12px` font, `mantle` background, `surface0` border

### Flow Management Dialog Specifics

**Three-column layout** with islands:
1. **Sidebar nav** (148px): Flows / Actions
2. **List column** (196px, `mantle`): Filter select at top, scrollable item list, add button at bottom
3. **Editor column** (`base`): Scrollable content with sticky footer

**Editor footer**: Sits outside the scroll area. `12px 24px` padding. Delete button (destructive variant) pushed to the left with `margin-right: auto`. Cancel (ghost) and Save (primary) on the right.

**Action cards**: `rgba(24, 24, 37, 0.4)` background, `surface0` border, `8px` border-radius. Number, name, and type badge in a row.

### Button Hierarchy

Three button variants used across dialog footers:
- **Primary**: `blue` background, `crust` text (Save actions)
- **Ghost**: `mantle` background, `surface0` border, `subtext0` text (Cancel)
- **Danger**: Transparent with `red` text and faint red border/background (Delete)

## Files to Modify

### UI Primitives (shared changes)
- `packages/ui/src/components/ui/dialog.tsx` — Update `DialogContent` default classes for island shell (crust background, padding, border-radius). Update `DialogHeader` for equal padding.

### Settings Dialog
- `packages/ui/src/components/settings/SettingsModal.tsx` — Rewrite layout: island shell, sidebar with shared nav pattern, horizontal setting rows. Remove `DialogDescription`. Replace raw `<input>` (OpenCode model) with `Input` component. Make data dir path full width.

### Appearance Dialog
- `packages/ui/src/components/appearance/AppearanceDialog.tsx` — Replace `Tabs`/`TabsList`/`TabsTrigger` with sidebar nav + state-driven content switching (same pattern as Settings sections).
- `packages/ui/src/components/appearance/FontsTab.tsx` — Restructure into font groups: each section (Application/Terminal/Editor) is a single hoverable container with label + controls.
- `packages/ui/src/components/appearance/ImportTab.tsx` — Replace raw `<button>` elements with `Button` component.

### Flow Management Dialog
- `packages/ui/src/components/flows/FlowManagementDialog.tsx` — Rewrite layout: island shell with three-column islands. Apply shared nav pattern for Flows/Actions tabs.
- `packages/ui/src/components/flows/FlowEditor.tsx` — Move footer outside scroll area (sticky). Apply consistent field styling (stacked pattern with uppercase labels).
- `packages/ui/src/components/flows/ActionEditor.tsx` — Same footer and field styling changes as FlowEditor.

### No New Files Required

All changes are to existing components. The island layout and shared patterns are achieved through Tailwind classes — no new shared components or CSS files needed.

## Implementation Notes

- **Backup originals**: Before modifying each file, copy the original to `<filename>.backup.tsx` in the same directory for quick rollback.
- **Theme variables**: The design uses CSS variable names that map to Tailwind's existing theme tokens (e.g., `bg-background` maps to `base`, `bg-muted` maps to `mantle`). The actual mapping depends on the active theme, so use the existing Tailwind classes — don't hardcode Catppuccin hex values.
- **No new dependencies**: Everything uses existing Radix primitives, Tailwind classes, and the existing component library.
- **Appearance tab state**: Replace `Tabs` component with local `useState` for the active section, mirroring how Settings already manages its `section` state.

## Visual Reference

Mockups are in `.superpowers/brainstorm/94800-1773859115/mockup-refined-v4.html` — open locally to see the approved design with all iterations applied.
