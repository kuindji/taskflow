#!/usr/bin/env bash
# Downloads Catppuccin Macchiato file icons from catppuccin/vscode-icons.
# Requires: gh (GitHub CLI), base64, python3
# Usage: ./scripts/download-catppuccin-icons.sh

set -euo pipefail

DEST="packages/ui/public/icons/catppuccin"
FLAVOR="macchiato"

mkdir -p "$DEST"

echo "Fetching icon list for flavor: $FLAVOR..."
ICONS=$(gh api "repos/catppuccin/vscode-icons/git/trees/main?recursive=1" \
  --jq ".tree[] | select(.path | startswith(\"icons/$FLAVOR/\")) | .path" \
  | sed "s|icons/$FLAVOR/||")

TOTAL=$(echo "$ICONS" | wc -l | tr -d ' ')
echo "Found $TOTAL icons. Downloading..."

COUNT=0
echo "$ICONS" | while read -r icon; do
  encoded=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$icon")
  content=$(gh api "repos/catppuccin/vscode-icons/contents/icons/$FLAVOR/$encoded" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
  if [ -n "$content" ]; then
    echo "$content" > "$DEST/$icon"
    COUNT=$((COUNT + 1))
    printf "\r  Downloaded %d / %s" "$COUNT" "$TOTAL"
  fi
done

echo ""
echo "Done. Icons saved to $DEST"
