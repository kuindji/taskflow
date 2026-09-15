#!/bin/sh
# Build taskflow-tui and taskflow-backend from this checkout and install them.
#
#   bun run linux-setup                        installs into ~/.local/bin
#   PREFIX=/usr/local bun run linux-setup      installs into /usr/local/bin
#
# Run it again after `git pull` to update.
set -eu

if [ "$(uname -s)" != "Linux" ]; then
    echo "linux-setup: this script is for Linux." >&2
    exit 1
fi

missing=""
for tool in bun git ssh; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
    echo "linux-setup: missing required tools:$missing" >&2
    exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
bin_dir="${PREFIX:-$HOME/.local}/bin"

echo "==> Installing dependencies"
(cd "$root" && bun install --frozen-lockfile)

echo "==> Building taskflow-backend"
(cd "$root/packages/backend" && bun run build:bin)

echo "==> Building taskflow-tui"
(cd "$root/packages/tui" && bun run build:bin)

# Copy to a temp name and rename over the old binary: writing into a binary that
# is running, such as an open TUI, fails or corrupts it, while a rename does not.
tmp_files=""
trap 'for f in $tmp_files; do rm -f "$f"; done' EXIT
install_bin() {
    dest="$bin_dir/$(basename "$1")"
    tmp="$dest.tmp.$$"
    tmp_files="$tmp_files $tmp"
    cp "$1" "$tmp"
    chmod 755 "$tmp"
    mv -f "$tmp" "$dest"
    echo "    $dest"
}

echo "==> Installing into $bin_dir"
mkdir -p "$bin_dir"
install_bin "$root/packages/backend/dist/taskflow-backend"
install_bin "$root/packages/tui/dist/taskflow-tui"

commit=$(git -C "$root" describe --always --dirty 2>/dev/null || echo unknown)
echo "==> Installed from commit $commit"

case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
        echo
        echo "$bin_dir is not on your PATH. Add this line to your shell profile:"
        echo "    export PATH=\"$bin_dir:\$PATH\""
        ;;
esac
