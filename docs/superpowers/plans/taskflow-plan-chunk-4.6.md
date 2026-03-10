# Chunk 4.6: Alert & Confirm Dialogs

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 4.5 — shadcn Primitives](taskflow-plan-chunk-4.5.md) | Next: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add imperative `confirm()` and `alert()` dialog functions backed by a Zustand store and shadcn AlertDialog, plus a `loading` prop for Button. This enables later chunks (5, 6, 7) to guard destructive actions with confirmation dialogs.

**Architecture:** A Zustand store (`dialog-store`) holds dialog state plus a FIFO queue of pending dialogs. Imperative `confirm()` and `alert()` functions enqueue requests and return promises that resolve when the user acts. A `DialogHost` component rendered once in App.tsx reads the active dialog and renders the AlertDialog. If the `onConfirm` handler returns a promise, the action button enters loading state (spinner, disabled) until resolved; if it rejects, the dialog stays open, loading stops, and the error is shown inline so the user can retry or cancel.

**Tech Stack:** React 19, Zustand 5, shadcn/ui (AlertDialog), cva, Tailwind CSS 4, lucide-react

> **Depends on:** Chunk 4.5 (shadcn components in `packages/ui/src/components/ui/`, `cn()` in `src/lib/utils.ts`, Button with variants).

---

### Task 4.6.1: Pull shadcn alert-dialog component

**Files:**
- Create: `packages/ui/src/components/ui/alert-dialog.tsx`
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Pull the component**

```bash
cd packages/ui && bunx shadcn@latest add alert-dialog
```

This installs `@radix-ui/react-alert-dialog` and generates `src/components/ui/alert-dialog.tsx`.

- [ ] **Step 2: Verify**

```bash
ls packages/ui/src/components/ui/alert-dialog.tsx
cd packages/ui && bunx tsc --noEmit
```

Expected: File exists, no type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ui/alert-dialog.tsx packages/ui/package.json packages/ui/bun.lockb
git commit -m "feat: pull shadcn alert-dialog component"
```

---

### Task 4.6.2: Add `loading` prop to Button

**Files:**
- Modify: `packages/ui/src/components/ui/button.tsx`

- [ ] **Step 1: Add loading prop**

1. Import `Loader2` from `lucide-react`
2. Add `loading?: boolean` to `ButtonProps`
3. When `loading` is true: button is `disabled`, prepend `<Loader2 className="h-4 w-4 animate-spin" />` before children
4. When `asChild` is true, `loading` is ignored (Slot passthrough)

```typescript
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  },
);
```

- [ ] **Step 2: Run typecheck**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ui/button.tsx
git commit -m "feat: add loading prop to Button with spinner icon"
```

---

### Task 4.6.3: Dialog store and imperative functions

**Files:**
- Create: `packages/ui/src/stores/dialog-store.ts`

- [ ] **Step 1: Create dialog store**

File: `packages/ui/src/stores/dialog-store.ts`

```typescript
import { create } from 'zustand';

type DialogVariant = 'default' | 'destructive';

interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;    // default: 'Confirm'
  cancelLabel?: string;     // default: 'Cancel'
  variant?: DialogVariant;  // default: 'default'
  onConfirm?: () => void | Promise<void>;
}

interface AlertOptions {
  title: string;
  description: string;
  confirmLabel?: string;    // default: 'OK'
  onConfirm?: () => void | Promise<void>;
}

interface DialogState {
  open: boolean;
  mode: 'alert' | 'confirm';
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: DialogVariant;
  loading: boolean;
  error: string | null;
  resolve: ((confirmed: boolean) => void) | null;
  onConfirm: (() => void | Promise<void>) | null;
}

type DialogRequest = Omit<DialogState, 'open' | 'loading' | 'error'>;

interface DialogStore extends DialogState {
  queue: DialogRequest[];
  show(state: DialogRequest): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  dismiss(): void;
}

const initialState: DialogState = {
  open: false,
  mode: 'alert',
  title: '',
  description: '',
  confirmLabel: 'OK',
  cancelLabel: 'Cancel',
  variant: 'default',
  loading: false,
  error: null,
  resolve: null,
  onConfirm: null,
};

function activateDialog(state: DialogRequest): DialogState {
  return { ...initialState, ...state, open: true };
}

const useDialogStore = create<DialogStore>((set) => ({
  ...initialState,
  queue: [],
  show(state) {
    set((current) => {
      if (current.open) {
        return { queue: [...current.queue, state] };
      }
      return { ...current, ...activateDialog(state) };
    });
  },
  setLoading(loading) { set({ loading }); },
  setError(error) { set({ error }); },
  dismiss() {
    set((current) => {
      const [next, ...rest] = current.queue;
      if (next) {
        return { ...activateDialog(next), queue: rest };
      }
      return { ...initialState, queue: [] };
    });
  },
}));

function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((outerResolve) => {
    useDialogStore.getState().show({
      mode: 'confirm',
      title: options.title,
      description: options.description,
      confirmLabel: options.confirmLabel ?? 'Confirm',
      cancelLabel: options.cancelLabel ?? 'Cancel',
      variant: options.variant ?? 'default',
      onConfirm: options.onConfirm ?? null,
      resolve: outerResolve,
    });
  });
}

function alert(options: AlertOptions): Promise<void> {
  return new Promise<void>((outerResolve) => {
    useDialogStore.getState().show({
      mode: 'alert',
      title: options.title,
      description: options.description,
      confirmLabel: options.confirmLabel ?? 'OK',
      cancelLabel: '',
      variant: 'default',
      onConfirm: options.onConfirm ?? null,
      resolve: () => outerResolve(),
    });
  });
}

export { useDialogStore, confirm, alert };
export type { ConfirmOptions, AlertOptions, DialogVariant };
```

Design notes:
- `confirm()` returns `Promise<boolean>` — `true` if confirmed, `false` if cancelled.
- `alert()` returns `Promise<void>` — resolves when dismissed.
- `show()` is FIFO — if a dialog is already open, new requests are appended to `queue` and shown only after the active dialog is dismissed.
- `resolve` typed as `((confirmed: boolean) => void) | null` — DialogHost calls `resolve(true)` only after `onConfirm` completes successfully, `resolve(false)` on cancel.
- If `onConfirm` throws or rejects, the dialog remains open, `loading` resets to `false`, and `error` is populated for inline display. The outer promise stays pending until the user retries successfully or cancels.
- `useDialogStore` exported only for `DialogHost` consumption.

- [ ] **Step 2: Run typecheck**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/dialog-store.ts
git commit -m "feat: add dialog store with imperative confirm() and alert() functions"
```

---

### Task 4.6.4: DialogHost component

**Files:**
- Create: `packages/ui/src/components/DialogHost.tsx`

- [ ] **Step 1: Implement DialogHost**

File: `packages/ui/src/components/DialogHost.tsx`

```tsx
import { useCallback } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useDialogStore } from '@/stores/dialog-store';
import { cn } from '@/lib/utils';

export function DialogHost() {
  const { open, mode, title, description, confirmLabel, cancelLabel,
    variant, loading, error, onConfirm, resolve, setLoading, setError, dismiss } = useDialogStore();

  const handleConfirm = useCallback(async () => {
    setError(null);

    if (!onConfirm) {
      resolve?.(true);
      dismiss();
      return;
    }

    try {
      const result = onConfirm();
      if (result && typeof result.then === 'function') {
        setLoading(true);
        await result;
        setLoading(false);
      }
      resolve?.(true);
      dismiss();
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Action failed. Please try again.');
    }
  }, [onConfirm, resolve, setLoading, setError, dismiss]);

  const handleCancel = useCallback(() => {
    resolve?.(false);
    dismiss();
  }, [resolve, dismiss]);

  // Block dismiss while loading
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && !loading) handleCancel();
  }, [loading, handleCancel]);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          {mode === 'confirm' && (
            <AlertDialogCancel onClick={handleCancel} disabled={loading}>
              {cancelLabel}
            </AlertDialogCancel>
          )}
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); void handleConfirm(); }}
            disabled={loading}
            className={cn(variant === 'destructive' && buttonVariants({ variant: 'destructive' }))}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Key behaviors:
- `e.preventDefault()` on AlertDialogAction prevents Radix auto-close — we control close manually via `dismiss()`
- If `onConfirm` returns a promise → `setLoading(true)`, wait, then close on success
- If `onConfirm` throws or rejects → keep the dialog open, stop loading, and show the error inline
- If `onConfirm` is sync or absent → close immediately on success
- Escape/overlay click blocked while `loading` is true
- Destructive variant overrides action button style via `buttonVariants()`
- Multiple imperative dialogs are handled FIFO — later dialogs wait in the queue until the current one is dismissed

- [ ] **Step 2: Run typecheck**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/DialogHost.tsx
git commit -m "feat: add DialogHost component for imperative alert/confirm dialogs"
```

---

### Task 4.6.5: Wire DialogHost into App.tsx

**Files:**
- Modify: `packages/ui/src/App.tsx`

> **Note:** Apply when App.tsx is built in Chunk 5/7. If already implemented, apply directly.

- [ ] **Step 1: Add DialogHost**

Import `DialogHost` and render it inside the outermost providers, after `ConnectionOverlay` and before `TooltipProvider`:

```tsx
import { DialogHost } from '@/components/DialogHost';

export function App() {
  return (
    <WebSocketProvider>
      <ConnectionOverlay />
      <DialogHost />
      <TooltipProvider>
        <AppShell
          sidebar={<TaskSidebar />}
          fileExplorer={<FileExplorer />}
          workspace={<Workspace />}
          taskInfo={<TaskInfoPanel />}
        />
      </TooltipProvider>
    </WebSocketProvider>
  );
}
```

`DialogHost` is placed outside `TooltipProvider` and `AppShell` because it manages its own portal (AlertDialog uses Radix Portal internally) and does not depend on layout context.

- [ ] **Step 2: Run typecheck**

```bash
cd packages/ui && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: wire DialogHost into App.tsx"
```

---

### Task 4.6.6: Usage reference for later chunks

> **Note:** This task documents how call sites in Chunks 5, 6, and 7 should adopt `confirm()` and `alert()`. No files are created or modified in this task — it is a reference for implementers.
>
> If `onConfirm` fails, the dialog stays open and shows the error message. Call sites do not need separate `try/catch` just to keep the confirm flow alive; only add local error handling when they need extra side effects beyond the inline dialog error.

**Delete Task** (Chunk 5, context menu):
```typescript
import { confirm } from '@/stores/dialog-store';

await confirm({
  title: 'Delete Task',
  description: 'This will permanently delete the task and all its sessions. This action cannot be undone.',
  confirmLabel: 'Delete',
  variant: 'destructive',
  onConfirm: () => deleteTask(taskId),
});
```

**Archive Task:**
```typescript
await confirm({
  title: 'Archive Task',
  description: 'This will archive the task. You can find it later in the archive.',
  confirmLabel: 'Archive',
  onConfirm: () => archiveTask(taskId),
});
```

**Remove Project:**
```typescript
await confirm({
  title: 'Remove Project',
  description: 'This will remove the project from Taskflow. Files on disk will not be affected.',
  confirmLabel: 'Remove',
  variant: 'destructive',
  onConfirm: () => removeProject(projectId),
});
```

**Revert File** (Chunk 6, ChangesPane):
```typescript
import { confirm } from '@/stores/dialog-store';

async function revertFile(file: GitFileStatus) {
  await confirm({
    title: 'Revert File',
    description: `Revert all changes to ${file.path}? This cannot be undone.`,
    confirmLabel: 'Revert',
    variant: 'destructive',
    onConfirm: async () => {
      await sendRequest(MSG.GIT_REVERT_FILE, {
        repoPath,
        filePath: file.path,
        status: file.status,
        previousPath: file.previousPath,
      });
      await fetchStatus();
      if (selectedFile === file.path) {
        setSelectedFile(null);
        setDiff(null);
      }
    },
  });
}
```
