# Notification Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve notification UX so users can read full notification text, dismiss explicitly, and navigate via a dedicated icon.

**Architecture:** Modify `NotificationPopover.tsx` to add a detail dialog and a navigate icon per notification row. Clicking a row opens a dialog with full text; clicking a chevron icon navigates to the session/task; clicking X dismisses. Popover no longer auto-closes on row click.

**Tech Stack:** React, Radix Dialog (shadcn), Lucide icons, Zustand store

---

### File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/components/sidebar/NotificationPopover.tsx` | Modify | Add detail dialog, navigate icon, change click behavior |

No new files needed. All changes are contained in the existing popover component.

---

### Task 1: Add navigate icon to notification rows

**Files:**
- Modify: `packages/ui/src/components/sidebar/NotificationPopover.tsx:1-123`

- [ ] **Step 1: Add ChevronRight import**

Add `ChevronRight` to the existing Lucide import on line 7:

```tsx
import { ChevronRight, X } from "lucide-react";
```

- [ ] **Step 2: Add `onNavigateClick` handler**

Add a new handler inside the `NotificationPopover` component, after the existing `handleDelete` function (after line 59):

```tsx
function handleNavigate(e: React.MouseEvent, notification: Notification) {
    e.stopPropagation();
    if (!notification.read) {
        void markAsRead(notification.id);
    }
    onNavigate(notification);
    onOpenChange(false);
}
```

- [ ] **Step 3: Change row click to only mark as read (no navigate)**

Replace the existing `handleItemClick` function (lines 48-54):

```tsx
function handleItemClick(notification: Notification) {
    if (!notification.read) {
        void markAsRead(notification.id);
    }
    setSelectedNotification(notification);
}
```

Note: `setSelectedNotification` will be added in Task 2. For now this will cause a compile error — that's expected and will be resolved in the next task.

- [ ] **Step 4: Add ChevronRight button to each notification row**

In the notification row markup (between the delete button and the closing `</button>` of the row), add the navigate icon. Replace the icon area (lines 106-113) so the row's action buttons become:

```tsx
<div className="mt-0.5 flex shrink-0 items-center gap-0.5">
    <Button
        variant="ghost"
        size="icon-2xs"
        onClick={(e) => handleNavigate(e, notification)}
        aria-label="Go to session"
        className="text-muted-foreground [-webkit-app-region:no-drag]">
        <ChevronRight className="h-3 w-3" />
    </Button>
    <Button
        variant="ghost"
        size="icon-2xs"
        onClick={(e) => handleDelete(e, notification)}
        aria-label="Delete notification"
        className="text-muted-foreground [-webkit-app-region:no-drag]">
        <X className="h-3 w-3" />
    </Button>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/sidebar/NotificationPopover.tsx
git commit -m "feat: add navigate icon to notification rows"
```

---

### Task 2: Add notification detail dialog

**Files:**
- Modify: `packages/ui/src/components/sidebar/NotificationPopover.tsx`

- [ ] **Step 1: Add Dialog imports**

Add Dialog imports at the top of the file:

```tsx
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
```

- [ ] **Step 2: Add `useState` import**

Add `useState` to the React import:

```tsx
import { useState, type ReactNode } from "react";
```

- [ ] **Step 3: Add selected notification state**

Inside the `NotificationPopover` component, after the store selectors (after line 38), add:

```tsx
const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
```

- [ ] **Step 4: Add dialog navigate handler**

After the `handleNavigate` function, add:

```tsx
function handleDialogNavigate() {
    if (!selectedNotification) return;
    onNavigate(selectedNotification);
    setSelectedNotification(null);
    onOpenChange(false);
}
```

- [ ] **Step 5: Add the Dialog component**

After the closing `</Popover>` tag and before the function's closing return parenthesis, add:

```tsx
<Dialog
    open={selectedNotification !== null}
    onOpenChange={(open) => {
        if (!open) setSelectedNotification(null);
    }}>
    <DialogContent className="sm:max-w-md">
        <DialogHeader>
            <DialogTitle className="text-sm font-medium">
                {selectedNotification
                    ? getProjectName(selectedNotification.projectId)
                    : ""}
            </DialogTitle>
            <DialogDescription className="sr-only">
                Notification details
            </DialogDescription>
        </DialogHeader>
        <p className="text-foreground whitespace-pre-wrap text-sm">
            {selectedNotification?.message}
        </p>
        <DialogFooter className="sm:justify-between">
            <span className="text-muted-foreground text-xs">
                {selectedNotification
                    ? formatRelativeTime(selectedNotification.createdAt)
                    : ""}
            </span>
            <Button variant="outline" size="sm" onClick={handleDialogNavigate}>
                Go to session
            </Button>
        </DialogFooter>
    </DialogContent>
</Dialog>
```

- [ ] **Step 6: Wrap return in a fragment**

The component currently returns a single `<Popover>`. Since we're adding a `<Dialog>` sibling, wrap the return value in a fragment:

```tsx
return (
    <>
        <Popover open={open} onOpenChange={onOpenChange}>
            {/* ... existing popover content ... */}
        </Popover>
        <Dialog ...>
            {/* ... dialog from step 5 ... */}
        </Dialog>
    </>
);
```

- [ ] **Step 7: Verify the app compiles and test manually**

Run: `bun run --filter @taskflow/ui dev` or check the running dev server.

Expected: 
- Clicking a notification row opens a dialog with the full message
- Clicking the chevron navigates to the session and closes the popover
- Clicking X dismisses the notification
- The popover stays open when clicking a row

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/components/sidebar/NotificationPopover.tsx
git commit -m "feat: add notification detail dialog with full message text"
```
