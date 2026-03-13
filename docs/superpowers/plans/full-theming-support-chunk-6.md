# Chunk 6: Online Theme Browsing (terminalcolors.com)

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 30: Backend Browse + Download Endpoints

The backend contract for online browsing has two parts:
- `THEME_BROWSE_LIST` returns a curated or scraped list of online themes with backend-owned stable ids, preview colors, and download URLs.
- `THEME_DOWNLOAD` downloads the Alacritty TOML, parses it, saves it under the provided id, and returns the refreshed installed theme list plus the actual installed canonical id.

- [ ] **Step 1: Test the download handler manually**

Start the backend, send a `THEME_BROWSE_LIST` request and verify it returns online theme metadata including preview colors. Then send a `THEME_DOWNLOAD` request with `id: "terminalcolors-dracula-default", url: "https://terminalcolors.com/downloads/alacritty/dracula-default.toml"`, verify it installs the parsed theme and returns the updated local theme list plus `importedThemeId`.

- [ ] **Step 2: Commit any fixes**

### Task 31: BrowseOnlineTab Implementation

**Files:**
- Modify: `packages/ui/src/components/appearance/BrowseOnlineTab.tsx`

- [ ] **Step 1: Implement the browse UI**

The component needs to:
1. Fetch the theme list via `MSG.THEME_BROWSE_LIST`
2. Display a grid of theme cards with preview swatches
3. On click, call `useThemeStore((s) => s.downloadOnlineTheme)` so the backend response can update the installed list and activate the returned `importedThemeId`

This requires understanding the terminalcolors.com page structure to extract theme names, download URLs, and preview colors. The approach:
- Backend owns discovery: either scrape `https://terminalcolors.com/` or expose a curated fallback list when scraping is brittle
- UI only consumes the backend response and never fetches terminalcolors.com directly

Implementation details will depend on the actual page structure at build time. Maintain a curated fallback list of popular themes with stable backend-owned ids such as `terminalcolors-one-dark` so bundled theme ids remain reserved and the UI contract does not change if scraping fails.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/BrowseOnlineTab.tsx
git commit -m "feat: implement online theme browser"
```

### Task 32: Final Integration Test

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run all shared tests**

Run: `cd packages/shared && bun test`
Expected: All PASS

- [ ] **Step 3: Build UI**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

Verify end-to-end:
- App starts with Catppuccin Mocha (default)
- Opening Appearance dialog shows all bundled themes
- Clicking a theme immediately changes app colors
- Terminal colors update
- Monaco editor colors update
- Theme persists after app restart
- Import tab shows detected terminal apps (if any installed)
- Custom theme files in `~/.config/taskflow/themes/` appear in the grid
