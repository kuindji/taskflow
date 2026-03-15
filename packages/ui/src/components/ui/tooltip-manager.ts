// --- Tooltip Manager (module-level singleton) ---
// Tracks the currently open tooltip and runs a global safety-net listener
// that force-closes tooltips when the mouse leaves the trigger area
// (catches cases where mouseLeave events are missed across panel boundaries)

interface TooltipRegistration {
    triggerEl: HTMLElement;
    contentEl: HTMLElement | null;
    close: () => void;
}

let currentTooltip: TooltipRegistration | null = null;
let mountCount = 0;
let scrollSuppressUntil = 0;

const SCROLL_SUPPRESS_MS = 150;

function isScrollSuppressed() {
    return Date.now() < scrollSuppressUntil;
}

function handleGlobalScroll() {
    scrollSuppressUntil = Date.now() + SCROLL_SUPPRESS_MS;
    if (currentTooltip) {
        currentTooltip.close();
        currentTooltip = null;
    }
}

function handleGlobalMouseOver(e: MouseEvent) {
    if (!currentTooltip) return;
    const target = e.target as Node;
    const { triggerEl, contentEl } = currentTooltip;
    if (triggerEl.contains(target) || contentEl?.contains(target)) return;
    currentTooltip.close();
    currentTooltip = null;
}

function registerTooltip(reg: TooltipRegistration) {
    if (currentTooltip && currentTooltip !== reg) {
        currentTooltip.close();
    }
    currentTooltip = reg;
}

function unregisterTooltip(reg: TooltipRegistration) {
    if (currentTooltip === reg) {
        currentTooltip = null;
    }
}

function mountManager() {
    if (mountCount === 0) {
        document.addEventListener("mouseover", handleGlobalMouseOver, true);
        document.addEventListener("wheel", handleGlobalScroll, true);
        document.addEventListener("scroll", handleGlobalScroll, true);
    }
    mountCount++;
}

function unmountManager() {
    mountCount--;
    if (mountCount === 0) {
        document.removeEventListener("mouseover", handleGlobalMouseOver, true);
        document.removeEventListener("wheel", handleGlobalScroll, true);
        document.removeEventListener("scroll", handleGlobalScroll, true);
    }
}

export { isScrollSuppressed, registerTooltip, unregisterTooltip, mountManager, unmountManager };
export type { TooltipRegistration };
