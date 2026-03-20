const OPEN_DIALOG_CONTENT_SELECTOR =
    "[data-slot='dialog-content'], [data-slot='alert-dialog-content']";

function isEditableElement(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) return false;

    if (element.isContentEditable) return true;

    const tagName = element.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function isDialogOpen() {
    if (typeof document === "undefined") return false;
    return document.querySelector(OPEN_DIALOG_CONTENT_SELECTOR) !== null;
}

export { isDialogOpen, isEditableElement };
