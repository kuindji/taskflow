# Chunk 4.5: shadcn/ui Primitives Setup

> Part of [Taskflow Implementation Plan](taskflow-plan.md) | Prev: [Chunk 4 — Electron Shell](taskflow-plan-chunk-4.md) | Next: [Chunk 5 — UI Core](taskflow-plan-chunk-5.md)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize shadcn/ui in the UI package with Catppuccin Mocha theme and 13 reusable primitive components.

**Architecture:** shadcn/ui components are pulled into `packages/ui/src/components/ui/` using the CLI. The Catppuccin Mocha palette maps to shadcn's CSS variable convention in `global.css`. App-specific cva variants extend Button and Badge for Taskflow's needs.

**Tech Stack:** shadcn/ui, Tailwind CSS v4, class-variance-authority, clsx, tailwind-merge, Radix UI, lucide-react

> **Depends on:** Chunk 1 (packages/ui scaffold must exist with package.json, tsconfig.json, index.html, global.css, vite.config.ts or equivalent).

---

### Task 4.5.1: Update global.css with shadcn theme variables

**Files:**
- Modify: `packages/ui/src/styles/global.css`

- [ ] **Step 1: Replace the @theme block with shadcn CSS variables**

File: `packages/ui/src/styles/global.css`
```css
@import "tailwindcss";

/*
  Tailwind v4 requires namespaced variables in @theme for utility classes to work:
  --color-* for colors, --radius-* for border-radius, etc.
  We use @theme inline so these map to existing CSS custom properties without
  creating duplicate properties.
*/
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

:root {
  --background: #1e1e2e;
  --foreground: #cdd6f4;
  --card: #181825;
  --card-foreground: #cdd6f4;
  --popover: #313244;
  --popover-foreground: #cdd6f4;
  --primary: #cdd6f4;
  --primary-foreground: #1e1e2e;
  --secondary: #313244;
  --secondary-foreground: #a6adc8;
  --muted: #313244;
  --muted-foreground: #585b70;
  --accent: #89b4fa;
  --accent-foreground: #1e1e2e;
  --destructive: #f38ba8;
  --destructive-foreground: #1e1e2e;
  --border: #313244;
  --input: #313244;
  --ring: #89b4fa;
  --radius: 0.5rem;
  --chart-1: #89b4fa;
  --chart-2: #a6e3a1;
  --chart-3: #f9e2af;
  --chart-4: #f38ba8;
  --chart-5: #cba6f7;
  --success: #a6e3a1;
  --success-foreground: #1e1e2e;
  --warning: #f9e2af;
  --warning-foreground: #1e1e2e;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  @apply bg-background text-foreground overflow-hidden;
}
```

Note: This replaces the Chunk 1 `@theme` block. Raw CSS variables go in `:root` (shadcn convention). The `@theme inline` block maps them to Tailwind v4's namespace (`--color-*`, `--radius-*`) so utility classes like `bg-background`, `text-accent`, `border-l-success` work correctly. The `body` class changes from `bg-base text-primary` to `bg-background text-foreground`.

- [ ] **Step 2: Update index.html body class if needed**

Check `packages/ui/index.html`. If the `<body>` tag has any classes referencing old token names (e.g., `bg-base`), update them. The current Chunk 1 plan has no body classes in HTML (they're applied via CSS), so this is likely a no-op.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/styles/global.css
git commit -m "feat: update global.css with shadcn CSS variable convention"
```

---

### Task 4.5.2: Initialize shadcn CLI and cn() utility

**Files:**
- Create: `packages/ui/components.json`
- Create: `packages/ui/src/lib/utils.ts`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/tsconfig.json`

- [ ] **Step 1: Add path aliases to tsconfig.json**

shadcn components use `@/` path aliases. Update `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 2: Add path alias resolution to vite.config.ts**

File: `packages/ui/vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 3: Install shadcn dependencies**

```bash
cd packages/ui && bun add class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 4: Create cn() utility**

File: `packages/ui/src/lib/utils.ts`
```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Create components.json**

File: `packages/ui/components.json`
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/global.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 6: Verify setup**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/ui/components.json packages/ui/src/lib/utils.ts packages/ui/tsconfig.json packages/ui/vite.config.ts packages/ui/package.json packages/ui/bun.lockb
git commit -m "feat: initialize shadcn CLI config and cn() utility"
```

---

### Task 4.5.3: Pull shadcn components

**Files:**
- Create: `packages/ui/src/components/ui/button.tsx`
- Create: `packages/ui/src/components/ui/input.tsx`
- Create: `packages/ui/src/components/ui/textarea.tsx`
- Create: `packages/ui/src/components/ui/card.tsx`
- Create: `packages/ui/src/components/ui/select.tsx`
- Create: `packages/ui/src/components/ui/tabs.tsx`
- Create: `packages/ui/src/components/ui/collapsible.tsx`
- Create: `packages/ui/src/components/ui/scroll-area.tsx`
- Create: `packages/ui/src/components/ui/tooltip.tsx`
- Create: `packages/ui/src/components/ui/separator.tsx`
- Create: `packages/ui/src/components/ui/badge.tsx`
- Create: `packages/ui/src/components/ui/dropdown-menu.tsx`
- Create: `packages/ui/src/components/ui/dialog.tsx`
- Modify: `packages/ui/package.json` (Radix deps auto-installed)

- [ ] **Step 1: Pull all 13 components**

```bash
cd packages/ui && bunx shadcn@latest add button input textarea card select tabs collapsible scroll-area tooltip separator badge dropdown-menu dialog
```

This installs the required `@radix-ui/*` packages automatically and generates component files in `src/components/ui/`.

- [ ] **Step 2: Verify all files exist**

```bash
ls packages/ui/src/components/ui/
```

Expected: `badge.tsx`, `button.tsx`, `card.tsx`, `collapsible.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `input.tsx`, `scroll-area.tsx`, `select.tsx`, `separator.tsx`, `tabs.tsx`, `textarea.tsx`, `tooltip.tsx`

- [ ] **Step 3: Run typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd packages/ui && git add src/components/ui/ package.json bun.lockb
git commit -m "feat: pull 13 shadcn/ui components (Button, Input, Tabs, etc.)"
```

---

### Task 4.5.4: Add app-specific Button and Badge variants

**Files:**
- Modify: `packages/ui/src/components/ui/button.tsx`
- Modify: `packages/ui/src/components/ui/badge.tsx`

- [ ] **Step 1: Add icon-sm size and sidebar variant to Button**

Open `packages/ui/src/components/ui/button.tsx`. In the `buttonVariants` cva config:

Add to the `variant` object:
```typescript
sidebar: 'text-muted-foreground hover:bg-muted hover:text-foreground',
```

Add to the `size` object:
```typescript
'icon-sm': 'h-6 w-6 rounded-sm',
```

- [ ] **Step 2: Add colorScheme variant to Badge**

Open `packages/ui/src/components/ui/badge.tsx`. The generated Badge uses `cva()`. Make the following surgical edits to add a `colorScheme` variant axis with compound variants:

1. In the `variants` object (inside the `cva()` call), add after the `variant` object:
```typescript
colorScheme: {
  claude: '',
  codex: '',
  active: '',
  archived: '',
},
```

2. Add a `compoundVariants` array after the `variants` object (peer to `variants` and `defaultVariants`):
```typescript
compoundVariants: [
  { variant: 'outline', colorScheme: 'claude', className: 'bg-success/20 text-success border-success/30' },
  { variant: 'outline', colorScheme: 'codex', className: 'bg-warning/20 text-warning border-warning/30' },
  { variant: 'outline', colorScheme: 'active', className: 'bg-accent/20 text-accent border-accent/30' },
  { variant: 'outline', colorScheme: 'archived', className: 'bg-muted text-muted-foreground border-muted' },
  { variant: 'default', colorScheme: 'claude', className: 'bg-success/20 text-success border-success/30' },
  { variant: 'default', colorScheme: 'codex', className: 'bg-warning/20 text-warning border-warning/30' },
  { variant: 'default', colorScheme: 'active', className: 'bg-accent/20 text-accent border-accent/30' },
  { variant: 'default', colorScheme: 'archived', className: 'bg-muted text-muted-foreground border-muted' },
],
```

Note: `colorScheme` only applies when `variant` is `"outline"` or `"default"`. This prevents colorScheme styles from bleeding into `destructive` or `secondary` badge variants.

3. In the `Badge` component function signature, add `colorScheme` to the destructured props and pass it to `badgeVariants()`. Use `useMemo` to memoize the `cn()` result:
```typescript
import { useMemo } from 'react';

function Badge({ className, variant, colorScheme, ...props }: BadgeProps) {
  const classes = useMemo(
    () => cn(badgeVariants({ variant, colorScheme }), className),
    [variant, colorScheme, className],
  );
  return (
    <div className={classes} {...props} />
  );
}
```

4. In the `BadgeProps` interface, ensure it extends `VariantProps<typeof badgeVariants>` (the generated code should already do this, which will pick up the new `colorScheme` prop automatically).

- [ ] **Step 3: Run typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/ui/button.tsx packages/ui/src/components/ui/badge.tsx
git commit -m "feat: add app-specific Button (icon-sm, sidebar) and Badge (colorScheme) variants"
```

---

### Task 4.5.5: Verify all components render

**Files:**
- Create (temporary): `packages/ui/src/Showcase.tsx`
- Modify (temporary): `packages/ui/src/App.tsx`

- [ ] **Step 1: Create temporary showcase**

File: `packages/ui/src/Showcase.tsx`
```tsx
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { Plus, X, ChevronDown } from 'lucide-react';

export function Showcase() {
  return (
    <TooltipProvider>
      <div className="p-6 bg-background text-foreground min-h-screen space-y-6">
        <h1 className="text-xl font-bold">Component Showcase</h1>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Buttons</h2>
          <div className="flex gap-2 items-center">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="sidebar">Sidebar</Button>
            <Button size="sm">Small</Button>
            <Button size="icon-sm"><Plus className="h-3 w-3" /></Button>
            <Button size="icon"><X className="h-4 w-4" /></Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Inputs</h2>
          <div className="flex gap-2 items-center max-w-md">
            <Input placeholder="Search tasks..." />
            <Textarea placeholder="Add notes..." rows={2} />
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Badges</h2>
          <div className="flex gap-2 items-center flex-wrap">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline" colorScheme="claude">Claude</Badge>
            <Badge variant="outline" colorScheme="codex">Codex</Badge>
            <Badge variant="outline" colorScheme="active">Active</Badge>
            <Badge variant="outline" colorScheme="archived">Archived</Badge>
          </div>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tabs</h2>
          <Tabs defaultValue="tab1">
            <TabsList>
              <TabsTrigger value="tab1">Claude</TabsTrigger>
              <TabsTrigger value="tab2">Editor</TabsTrigger>
              <TabsTrigger value="tab3">Browser</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1">Claude session content</TabsContent>
            <TabsContent value="tab2">Editor content</TabsContent>
            <TabsContent value="tab3">Browser content</TabsContent>
          </Tabs>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Card</h2>
          <Card className="max-w-sm">
            <CardHeader><CardTitle>Task Card</CardTitle></CardHeader>
            <CardContent>Card content here</CardContent>
          </Card>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Collapsible</h2>
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-sm">
              <ChevronDown className="h-3 w-3" /> Project Name
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-4 pt-1 text-sm text-muted-foreground">
              Collapsible content here
            </CollapsibleContent>
          </Collapsible>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">ScrollArea</h2>
          <ScrollArea className="h-24 w-48 rounded border border-border p-2">
            {Array.from({ length: 20 }, (_, i) => (
              <div key={i} className="text-xs text-secondary-foreground">Item {i + 1}</div>
            ))}
          </ScrollArea>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Tooltip</h2>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm">Hover me</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">DropdownMenu</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Open Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Claude Code</DropdownMenuItem>
              <DropdownMenuItem>Codex</DropdownMenuItem>
              <DropdownMenuItem>Browser</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </section>

        <Separator />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Dialog</h2>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">Open Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Action</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">Dialog body content</p>
            </DialogContent>
          </Dialog>
        </section>
      </div>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Temporarily wire showcase into App.tsx**

Replace `packages/ui/src/App.tsx` content with:
```tsx
import { Showcase } from './Showcase';

export function App() {
  return <Showcase />;
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Start dev server and verify it builds**

Run: `cd packages/ui && bunx vite build 2>&1 | tail -5`
Expected: Build completes successfully with no errors. This confirms all components compile and bundle correctly with the Catppuccin theme.

**Manual checkpoint (optional):** If running interactively, start `bunx vite` and open the URL in a browser to visually confirm colors and spacing.

- [ ] **Step 5: Remove showcase and restore App.tsx**

Delete `packages/ui/src/Showcase.tsx`.

Restore `packages/ui/src/App.tsx` to:
```tsx
export function App() {
  return (
    <div className="bg-background text-foreground h-screen flex items-center justify-center">
      <h1>Taskflow</h1>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: verify shadcn components render with Catppuccin theme"
```

Note: `Showcase.tsx` is not committed — it was a temporary verification tool.
