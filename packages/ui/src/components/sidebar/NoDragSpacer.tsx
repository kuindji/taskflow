/**
 * A thin spacer that opts out of Electron's drag region.
 * Used between sidebar rows so the gap area doesn't swallow scroll events.
 */
export function NoDragSpacer() {
    return <div className="h-0.5 [-webkit-app-region:no-drag]" />;
}
