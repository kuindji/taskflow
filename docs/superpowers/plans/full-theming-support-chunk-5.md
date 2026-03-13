# Chunk 5: Terminal App Parsers

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 22a: Install Parser Dependencies

**Files:**
- Modify: `packages/backend/package.json`

- [ ] **Step 1: Install TOML and YAML parsing packages**

```bash
cd packages/backend && bun add smol-toml yaml
```

`smol-toml` is used for Alacritty TOML themes. `yaml` is used for Warp YAML themes. Both are lightweight and well-maintained.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/package.json bun.lockb
git commit -m "feat: add smol-toml and yaml dependencies for theme parsers"
```

### Task 23: Alacritty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/alacritty.ts`
- Create: `packages/backend/tests/services/theme-parsers/alacritty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Alacritty TOML format. Use a sample TOML string matching the format from terminalcolors.com (the Dracula example from earlier research).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && bun test tests/services/theme-parsers/alacritty.test.ts`

- [ ] **Step 3: Implement parser**

Use `smol-toml` (installed in Task 22b) to parse the TOML. Extract `colors.primary.foreground`, `colors.primary.background`, `colors.normal.*`, `colors.bright.*`, `colors.selection.*`, `colors.cursor.*` into a `ThemeSource`. Export both `parseAlacrittyToml(toml: string, name: string): ThemeSource` (for online download handler) and `detectAlacritty` / `parseAlacritty` (for import flow).

Detect Alacritty by checking if `~/.config/alacritty/alacritty.toml` exists.

- [ ] **Step 4: Run tests to verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/theme-parsers/alacritty.ts packages/backend/tests/services/theme-parsers/alacritty.test.ts
git commit -m "feat: add Alacritty theme parser"
```

### Task 24: Ghostty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/ghostty.ts`
- Create: `packages/backend/tests/services/theme-parsers/ghostty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Ghostty config format: `background = #282a36`, `foreground = #f8f8f2`, `palette = 0=#21222c`, `palette = 1=#ff5555`, etc.

- [ ] **Step 2: Implement parser**

Simple line-by-line parsing. `palette = N=hex` maps to ANSI colors 0-15. `background`, `foreground`, `cursor-color`, `selection-background` are direct.

Detect by checking `~/.config/ghostty/config`.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/ghostty.ts packages/backend/tests/services/theme-parsers/ghostty.test.ts
git commit -m "feat: add Ghostty theme parser"
```

### Task 25: Kitty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/kitty.ts`
- Create: `packages/backend/tests/services/theme-parsers/kitty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Kitty config: `foreground #f8f8f2`, `background #282a36`, `color0 #21222c`, `color1 #ff5555`, etc.

- [ ] **Step 2: Implement parser**

Line-by-line: `colorN hex` maps to ANSI colors 0-15. `foreground`, `background`, `cursor`, `selection_foreground`, `selection_background` are direct.

Detect by checking `~/.config/kitty/kitty.conf`.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/kitty.ts packages/backend/tests/services/theme-parsers/kitty.test.ts
git commit -m "feat: add Kitty theme parser"
```

### Task 26: Warp Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/warp.ts`
- Create: `packages/backend/tests/services/theme-parsers/warp.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Warp YAML theme format. Sample:
```yaml
accent: '#bd93f9'
background: '#282a36'
foreground: '#f8f8f2'
terminal_colors:
  normal:
    black: '#21222c'
    red: '#ff5555'
    green: '#50fa7b'
    yellow: '#f1fa8c'
    blue: '#bd93f9'
    magenta: '#ff79c6'
    cyan: '#8be9fd'
    white: '#f8f8f2'
  bright:
    black: '#6272a4'
    red: '#ff6e6e'
    green: '#69ff94'
    yellow: '#ffffa5'
    blue: '#d6acff'
    magenta: '#ff92df'
    cyan: '#a4ffff'
    white: '#ffffff'
```

- [ ] **Step 2: Implement parser**

Warp themes are YAML. Use the `yaml` package (installed in Task 22b) to parse. Keys: `background`, `foreground`, `terminal_colors.normal.*`, `terminal_colors.bright.*`. Map `cursor` to foreground if not present.

Detect by scanning `~/.warp/themes/` for `.yaml` files.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/warp.ts packages/backend/tests/services/theme-parsers/warp.test.ts
git commit -m "feat: add Warp theme parser"
```

### Task 27: iTerm2 Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/iterm2.ts`
- Create: `packages/backend/tests/services/theme-parsers/iterm2.test.ts`

- [ ] **Step 1: Write failing tests**

Test the color component conversion logic. iTerm2 stores colors as float RGB (0.0-1.0). Test that `{ "Red Component": 0.976, "Green Component": 0.545, "Blue Component": 0.659 }` converts to `#f98ba8` (approx). Test with a sample XML plist snippet.

- [ ] **Step 2: Implement parser**

iTerm2 stores profiles in a plist. Colors are stored as components: `Ansi 0 Color` with sub-keys `Red Component`, `Green Component`, `Blue Component` as float 0-1. Convert float→int→hex.

The plist at `~/Library/Preferences/com.googlecode.iterm2.plist` may be binary — use `plutil -convert xml1 -o -` to convert, then parse XML.

Detect by checking if `~/Library/Preferences/com.googlecode.iterm2.plist` exists.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/iterm2.ts packages/backend/tests/services/theme-parsers/iterm2.test.ts
git commit -m "feat: add iTerm2 theme parser"
```

### Task 28: Terminal.app Parser (Best-Effort)

**Files:**
- Create: `packages/backend/src/services/theme-parsers/terminal-app.ts`
- Create: `packages/backend/tests/services/theme-parsers/terminal-app.test.ts`

- [ ] **Step 1: Write failing tests**

Test with a sample `.terminal` plist XML snippet. Test that parsing failures return an empty array (graceful skip), not an error.

- [ ] **Step 2: Implement best-effort parser**

Terminal.app stores colors as NSKeyedArchiver data blobs in plist files. These are complex to decode. Implement a best-effort approach:
- Look for `.terminal` files in `~/Library/Preferences/` or common export locations
- Try to parse the plist XML and extract any color data that's in a recognizable format
- If decoding fails, return empty array gracefully

Detect by checking for `.terminal` files in the expected location.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/terminal-app.ts packages/backend/tests/services/theme-parsers/terminal-app.test.ts
git commit -m "feat: add Terminal.app theme parser (best-effort)"
```

### Task 29: Parser Index & Integration

**Files:**
- Create: `packages/backend/src/services/theme-parsers/index.ts`
- Modify: `packages/backend/src/handlers/theme.ts`
- Modify: `packages/backend/src/services/theme-service.ts`
- Modify: `packages/ui/src/stores/theme-store.ts`
- Modify: `packages/ui/src/components/appearance/ImportTab.tsx`
- Modify: `packages/ui/src/env.d.ts`
- Modify: `electron/src/preload.ts`
- Modify: `electron/src/main.ts`

- [ ] **Step 1: Create parser index**

```typescript
// packages/backend/src/services/theme-parsers/index.ts
// Re-export all parser detect/parse functions

export { detectAlacritty, parseAlacritty } from "./alacritty";
export { detectGhostty, parseGhostty } from "./ghostty";
export { detectKitty, parseKitty } from "./kitty";
export { detectWarp, parseWarp } from "./warp";
export { detectIterm2, parseIterm2 } from "./iterm2";
export { detectTerminalApp, parseTerminalApp } from "./terminal-app";
```

- [ ] **Step 2: Add import detection and file import to ThemeService and theme handler**

Add a method to `ThemeService` that runs all detectors and returns which apps have importable themes:

```typescript
async detectTerminalApps(): Promise<Array<{ app: string; themes: ThemeSource[] }>> {
    // Call each detector, return results
}

async importFromFile(path: string): Promise<ThemeRecord> {
    // Read the selected file, detect format by extension/content, parse into ThemeSource,
    // then save via ThemeService.save() so id collision rules are preserved.
}
```

Register `MSG.THEME_IMPORT_SCAN` in `packages/backend/src/handlers/theme.ts` and return:

```typescript
const apps = await themeService.detectTerminalApps();
return { apps } satisfies ThemeImportScanResponse;
```

Register `MSG.THEME_IMPORT_FILE` in `packages/backend/src/handlers/theme.ts`:

```typescript
const { path } = payload as ThemeImportFilePayload;
const record = await themeService.importFromFile(path);
const themes = await themeService.listAll();
return { themes, importedThemeId: record.id } satisfies ThemeImportResponse;
```

Do not overload `THEME_IMPORT`, which remains the direct write/import action when the UI already has a parsed `ThemeSource`.

- [ ] **Step 3: Add the Electron file-picker bridge**

Add `selectThemeFile(): Promise<string | null>` to `packages/ui/src/env.d.ts`, expose it from `electron/src/preload.ts`, and implement the IPC handler in `electron/src/main.ts` with `dialog.showOpenDialog({ properties: ["openFile"] })`.

Use filters for the formats we support or can sniff:
- JSON (`.json`)
- Alacritty (`.toml`)
- Warp (`.yaml`, `.yml`)
- macOS theme exports (`.plist`, `.terminal`)
- Plain text configs (`.conf`, no-extension fallback via "All Files")

- [ ] **Step 4: Update theme store with file import action**

Add `importThemeFile(path: string)` to `packages/ui/src/stores/theme-store.ts`. It should send `MSG.THEME_IMPORT_FILE`, receive `ThemeImportResponse`, refresh `themes`, and activate/persist `importedThemeId` if it is returned.

- [ ] **Step 5: Update ImportTab with real UI**

Replace the placeholder with:
- terminal app detection results from `MSG.THEME_IMPORT_SCAN`
- import buttons for detected terminal themes using `importTheme(theme)`
- a real "From File..." button that calls `window.taskflow?.selectThemeFile()`, then passes the returned path to `importThemeFile(path)`

The renderer should never parse the file itself. File selection happens in Electron, and file reading/parsing stays on the backend so all parser logic remains in one place.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/theme-parsers/ packages/backend/src/services/theme-service.ts packages/backend/src/handlers/theme.ts packages/ui/src/stores/theme-store.ts packages/ui/src/components/appearance/ImportTab.tsx packages/ui/src/env.d.ts electron/src/preload.ts electron/src/main.ts
git commit -m "feat: integrate terminal app parsers into import flow"
```
