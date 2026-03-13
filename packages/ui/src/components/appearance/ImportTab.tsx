function ImportTab() {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Import themes from your installed terminal apps.
            </p>
            <p className="text-muted-foreground text-xs">
                Coming soon: auto-detect iTerm2, Alacritty, Warp, Ghostty, Kitty, and Terminal.app
                themes.
            </p>
        </div>
    );
}

export { ImportTab };
