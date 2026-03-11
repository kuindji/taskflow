# Taskflow App Icon Design

## Overview

A monochrome line art icon for the Taskflow Electron desktop app, conveying productivity and speed through a checkmark-with-motion motif.

## Design

### Visual Elements

- **Shape**: Rounded square (rx=32 in 160-unit viewBox) with dark fill (#111111) and subtle border (#333333)
- **Checkmark**: White line art, 5.5-unit stroke, round caps and joins. Points: `48,82 → 70,108 → 118,52`
- **Motion lines**: Three horizontal lines to the left of the checkmark, staggered vertically with fading opacity:
  - Top line: y=68, x=28→52, opacity 0.6
  - Middle line: y=82, x=22→40, opacity 0.4
  - Bottom line: y=96, x=28→48, opacity 0.25
- **Stroke weight**: 2.5 units for motion lines and border, 5.5 units for checkmark
- **Padding**: The rounded rect has an 8-unit inset on each side (5% of viewBox). The SVG viewBox is expanded to `"-10 -10 180 180"` to add transparent padding (~6% per side), aligning with macOS HIG conventions (icon fills ~80% of canvas).

### Style

- Monochrome (black/white only)
- Line art / outline style
- Light stroke weight for an elegant, refined feel
- No gradients, shadows, or color

### SVG Source (160-unit coordinate system)

The SVG uses a 160-unit viewBox. The `width`/`height` attributes control the default render size but the viewBox scales to any target resolution.

```xml
<svg viewBox="-10 -10 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="144" height="144" rx="32" fill="#111111" stroke="#333333" stroke-width="2"/>
  <polyline points="48,82 70,108 118,52" stroke="white" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <line x1="28" y1="68" x2="52" y2="68" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
  <line x1="22" y1="82" x2="40" y2="82" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.4"/>
  <line x1="28" y1="96" x2="48" y2="96" stroke="white" stroke-width="2.5" stroke-linecap="round" opacity="0.25"/>
</svg>
```

## Required Outputs

### File Location

Create `electron/build/` directory (does not currently exist). Electron-builder auto-detects icons from the `build/` directory relative to the electron package.

All generated icon files should be committed to git (not generated at build time) since they change rarely and the generation requires platform-specific tools.

### macOS

- `electron/build/icon.icns` — Apple icon format
- Generated via `iconutil` from an `.iconset` directory containing these specifically-named files:
  - `icon_16x16.png` (16px), `icon_16x16@2x.png` (32px)
  - `icon_32x32.png` (32px), `icon_32x32@2x.png` (64px)
  - `icon_128x128.png` (128px), `icon_128x128@2x.png` (256px)
  - `icon_256x256.png` (256px), `icon_256x256@2x.png` (512px)
  - `icon_512x512.png` (512px), `icon_512x512@2x.png` (1024px)

### Windows

- `electron/build/icon.ico` — Windows icon format containing sizes: 16, 32, 48, 64, 128, 256px

### Linux

- `electron/build/icon.png` — single 512px PNG (electron-builder uses this for all Linux icon sizes)

## Implementation

Note: The full generation pipeline requires macOS (for `iconutil`). The `.icns` file cannot be generated on other platforms.

### Step 1: Create directory and SVG

```bash
mkdir -p electron/build
```

Save the SVG source above to `electron/build/icon.svg`.

### Step 2: Render SVG to PNGs

Use `rsvg-convert` (from `librsvg`, install via `brew install librsvg`) to render the SVG at all needed sizes:

```bash
cd electron/build

# Install if needed
brew install librsvg

# Render at each required size
for size in 16 32 48 64 128 256 512 1024; do
  rsvg-convert -w $size -h $size icon.svg > icon_${size}.png
done
```

### Step 3: Generate macOS .icns

```bash
cd electron/build
mkdir icon.iconset
cp icon_16.png icon.iconset/icon_16x16.png
cp icon_32.png icon.iconset/icon_16x16@2x.png
cp icon_32.png icon.iconset/icon_32x32.png
cp icon_64.png icon.iconset/icon_32x32@2x.png
cp icon_128.png icon.iconset/icon_128x128.png
cp icon_256.png icon.iconset/icon_128x128@2x.png
cp icon_256.png icon.iconset/icon_256x256.png
cp icon_512.png icon.iconset/icon_256x256@2x.png
cp icon_512.png icon.iconset/icon_512x512.png
cp icon_1024.png icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
```

### Step 4: Generate Windows .ico

Use ImageMagick (install via `brew install imagemagick` if needed) to create a multi-size `.ico`:

```bash
cd electron/build
magick icon_16.png icon_32.png icon_48.png icon_64.png icon_128.png icon_256.png icon.ico
```

### Step 5: Set up Linux icon

```bash
cd electron/build
cp icon_512.png icon.png
```

### Step 6: Clean up intermediates

Keep in `electron/build/`: `icon.svg`, `icon.icns`, `icon.ico`, `icon.png`. Remove intermediate sized PNGs (`icon_*.png`).

### Step 7: Verify

```bash
cd electron && bun run pack
```

Then inspect the icon in the packaged app at `electron/release/mac-arm64/Taskflow.app`: right-click > Get Info in Finder to see the icon, or open the app to check the dock icon.

## Electron-Builder Config

No config changes needed. Electron-builder's default `buildResources` directory is `build` (relative to the package with the `build` config, i.e., `electron/build/`). It auto-detects:
- `build/icon.icns` for macOS
- `build/icon.ico` for Windows
- `build/icon.png` for Linux
