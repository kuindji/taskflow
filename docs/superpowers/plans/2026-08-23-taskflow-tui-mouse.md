# Taskflow TUI — Mouse Support Implementation Plan

> Parent plan: `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.md` (Task 19).
> Progress is tracked in that plan's handoff,
> `docs/superpowers/plans/2026-08-22-taskflow-tui-stage1.handoff.md`, as tasks
> **19.1 – 19.6**. This document has no handoff of its own.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mouse works in the TUI. Clicking a sidebar row selects it, clicking a
tab opens it, clicking the session pane focuses it, and the wheel scrolls. A child
process that has asked for mouse reports receives them, encoded the way it asked.

**Why this exists:** the user asked for mouse support after the Task 15 smoke test.
Nothing in `packages/tui/src` enables mouse tracking today — `?1000h`/`?1002h`/`?1006h`
appear nowhere, and `MOUSE_OFF` appears only inside `leaveSequence`. The Stage 1 spec
mentions the mouse twice: once as a child mode to forward (`mouseTrackingMode`) and
once as something to switch off on exit. So this is new scope, not a defect fix, and
per the repo's own rule it gets a written plan reviewed by gpt-5.5 twice before code.

**Spec:** `docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`

## Global Constraints

Identical to the parent plan; repeated because this document is executed on its own.

- Use `bun`, never `npm` or `yarn`.
- No `as any`. `typescript-eslint` `strictTypeChecked` runs across the repo.
- Do not add `eslint-disable` comments. Fix the underlying type instead.
- Do not export a symbol unless another module imports it.
- Reuse types from `@taskflow/shared` before defining new ones. Protocol message
  names come from the `MSG` constant, never string literals.
- Do not add co-authored-by trailers to commits.
- Every file is under `packages/tui/` unless stated otherwise.
- Tests are `bun:test`, colocated as `<name>.test.ts` beside the file under test.
- Run the full check before every commit: `bun run lint && bun run typecheck && bun test`.
- Numbers inside template literals go through `String(...)`, as the rest of the
  package does, rather than relying on `restrict-template-expressions`' `allowNumber`.
- Validate with nothing else running. A `bun test` launched while another `bun test`
  or a `codex exec` is alive reports phantom failures; check
  `ps -ax -o command | grep "[c]odex exec"` first.

## Scope

**In:** SGR and legacy X10 mouse decoding; enabling and restoring outer-terminal
tracking; a hoisted layout and hit testing; sidebar/tab/pane click and wheel
bindings; per-child forwarding gated on the child's own tracking mode and encoded
in the encoding the child negotiated; a manual smoke test.

**Out, deliberately:**

- **Bare motion (`?1003h`, "any" tracking) is never enabled on the outer terminal.**
  It reports every pointer movement across the whole window, which the TUI has no
  hover UI to spend on and which would push a mouse-move packet down the wire at
  the terminal's sample rate. A child that asked for `any` still receives press,
  release and drag; it loses only motion with no button held. Revisit in Stage 2
  if a real child turns out to need it.
- **Double-click and drag-select.** No UI element wants a range yet.
- **Focus reporting (`?1004h`, `sendFocusMode`).** It is a separate child mode from
  the same spec table and belongs with `sendFocusMode` in Stage 2, not here.
- **Mouse in the help overlay or any pane that does not exist yet.**

## Interaction model

| Where | Event | Result |
|---|---|---|
| Sidebar | left press, or left drag | select the row under the pointer; focus the sidebar |
| Sidebar | wheel up / down | move the selection by one |
| Tab strip | left press on a tab | select that tab **and** focus the session |
| Tab strip | left press past the last tab | nothing |
| Session pane | left press, child wants no mouse | focus the session |
| Session pane | wheel, child wants no mouse | scroll that session's local scrollback by 3 lines |
| Session pane | any report, child wants the mouse | focus the session, forward the report |
| Anywhere | middle / right press | nothing (unbound; forwarded to a child that wants it) |

A report is forwarded to the child only when the pointer is inside the session
pane, a session is open, and that session's own `mouseTrackingMode` is not `none`.
A child that never asked for mouse reports must never receive one.

## Architecture

The existing input pipeline is bytes → decode → `KeyEvent[]` → `route` → either a UI
action or `encodeForChild` and a `SESSION_INPUT` request. Mouse reports arrive
interleaved with keys in the same byte stream, so they join that pipeline rather
than getting one of their own:

- `DecodeResult.events` becomes `InputEvent[]`, a union of the existing `KeyEvent`
  and a new `MouseReport`, discriminated on the `kind` field that `KeyEvent`
  already carries (`"press" | "repeat" | "release"` versus `"mouse"`).
- Decoding happens inside `decodeLegacy`'s CSI branch, which is the single choke
  point: `decodeKitty` delegates everything that is not `CSI … u` to it.
- Hit testing needs the frame's geometry, which `App.render()` computes locally and
  throws away. It moves into a pure `computeLayout(cols, rows, zoomed)`.
- Forwarding consults the child's `mouseTrackingMode` and its negotiated encoding,
  the same way `encodeForChild` consults `applicationCursorKeysMode`.

### The type name

`MouseReport`, not `MouseEvent`. `MouseEvent` is a DOM global; the tsconfig does not
pull `lib.dom`, so shadowing it would compile, but "report" is also what the
terminal specs call these sequences and it will not read as a browser type later.

### Why the union is discriminated on `kind`

`KeyEvent.kind` is already `"press" | "repeat" | "release"`. Giving `MouseReport`
`kind: "mouse"` makes `InputEvent` a discriminated union for free, and — the reason
that matters — leaves every existing assertion in `decode-legacy.test.ts` and
`decode-kitty.test.ts` compiling and green untouched. The alternative, wrapping both
in `{ type: "key" | "mouse", event }`, rewrites ~300 lines of passing tests to say
the same thing. `MouseReport` carries its own press/release/drag distinction in a
separate `action` field.

## File Structure

```
packages/tui/src/
  input/
    mouse.ts             NEW — MouseReport, scanning and parsing a report
    mouse.test.ts        NEW
    keys.ts              unchanged
    decode-legacy.ts     CHANGED — mouse branch, DecodeResult.events: InputEvent[]
    decode-kitty.ts      CHANGED — events array type only
    encode.ts            CHANGED — ChildModes gains mouse fields; encodeMouseForChild
    encode.test.ts       CHANGED — new cases appended
  term/
    tty.ts               CHANGED — enterSequence turns tracking on; TtyOptions.mouse
    session-terminal.ts  CHANGED — track mouse encoding mode; expose it; scroll()
  ui/
    layout.ts            NEW — Layout, computeLayout
    layout.test.ts       NEW
    session-pane.ts      CHANGED — tabSpans extracted and exported
    routing.ts           CHANGED — Action gains 3 members; routeMouse added
    app.ts               CHANGED — handleMouse, layout via computeLayout
  index.ts               CHANGED — feed loop dispatches on event kind; mouse opt-out
```

## Shared interfaces

```ts
// input/mouse.ts
type MouseButton =
    | "left"
    | "middle"
    | "right"
    | "wheel-up"
    | "wheel-down"
    | "wheel-left"
    | "wheel-right"
    | "none";

interface MouseReport {
    kind: "mouse";
    /** "drag" is motion with a button held; bare motion is never generated. */
    action: "press" | "release" | "drag";
    button: MouseButton;
    /** Zero-based, in outer-screen coordinates. */
    col: number;
    row: number;
    mods: KeyMods;
}

// input/decode-legacy.ts
type InputEvent = KeyEvent | MouseReport;
interface DecodeResult {
    events: InputEvent[];
    carry: string;
}

// input/encode.ts
interface ChildModes {
    applicationCursorKeys: boolean;
    bracketedPaste: boolean;
    kittyFlags: number | null;
    mouseTracking: "none" | "x10" | "vt200" | "drag" | "any";
    mouseEncoding: "x10" | "utf8" | "sgr" | "urxvt";
}

// ui/layout.ts
interface Layout {
    cols: number;
    rows: number;
    sidebarWidth: number;
    paneX: number;
    paneWidth: number;
    /** The tab strip occupies exactly this row. */
    tabRow: number;
    paneY: number;
    paneHeight: number;
}
```

`mouseTracking` reuses the union `IModes.mouseTrackingMode` already has
(`xterm-headless.d.ts`), so no new vocabulary is invented for it. `mouseEncoding`
has no `IModes` member at all — see Task 19.5.

---

### Task 19.1: Mouse report decoding

**Files:**
- Create: `packages/tui/src/input/mouse.ts`
- Test: `packages/tui/src/input/mouse.test.ts`
- Modify: `packages/tui/src/input/decode-legacy.ts`, `packages/tui/src/input/decode-kitty.ts`
- Test: `packages/tui/src/input/decode-legacy.test.ts` (append)

**Interfaces:**
- Produces: `MouseReport`, `MouseButton`, `InputEvent`,
  `parseSgrMouse(params: string, final: string): MouseReport | undefined`,
  `parseX10Mouse(payload: string): MouseReport | undefined`.
- Consumes: `KeyMods` (`input/keys.ts`).

**Two wire forms have to be read.**

*SGR (`?1006`)* — `CSI < b ; x ; y M` for press and motion, `… m` for release.
`x`/`y` are decimal and one-based, so nothing is lost past column 95. This is the
form the TUI asks for and the one it will get from every terminal in practice.

*X10 (the default)* — `CSI M` then exactly three bytes, `32 + b`, `32 + x`, `32 + y`.
This is what a terminal that honoured `?1000h` but ignored `?1006h` sends.

**The X10 form must be decoded even though we never ask for it.** `scanCsi` already
matches `ESC [ M` as a complete sequence with empty parameters and length 3 — and
today the three payload bytes that follow are left in the buffer and decoded as
ordinary characters. A click in column 49 sends byte `32 + 49 = 81`, which is `Q`,
which is the quit binding. Consuming the payload is the fix; parsing it is two more
lines.

`b` decomposes the same way in both forms:

| bits | meaning |
|---|---|
| `b & 3` | 0 left, 1 middle, 2 right — or, in X10 only, 3 = release |
| `b & 4` | shift |
| `b & 8` | alt (meta) |
| `b & 16` | ctrl |
| `b & 32` | motion (a drag, since a button is held) |
| `b & 64` | wheel: `b & 3` is then 0 up, 1 down, 2 left, 3 right |

In SGR the final byte carries press-versus-release and `b & 3` keeps naming the real
button; in X10 there is no release final, so `b & 3 == 3` is the release and the
button that was let go is unknowable — it decodes as `"none"`.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/input/mouse.test.ts` covers `parseSgrMouse` and `parseX10Mouse`
directly:

```ts
import { describe, test, expect } from "bun:test";
import { parseSgrMouse, parseX10Mouse } from "./mouse";
import { noMods } from "./keys";

describe("parseSgrMouse", () => {
    test("a left press reports zero-based coordinates", () => {
        expect(parseSgrMouse("<0;12;5", "M")).toEqual({
            kind: "mouse",
            action: "press",
            button: "left",
            col: 11,
            row: 4,
            mods: noMods(),
        });
    });

    test("the m final is a release and keeps the button", () => {
        expect(parseSgrMouse("<2;1;1", "m")?.action).toBe("release");
        expect(parseSgrMouse("<2;1;1", "m")?.button).toBe("right");
    });

    test("bit 32 is a drag", () => {
        expect(parseSgrMouse("<32;3;3", "M")?.action).toBe("drag");
        expect(parseSgrMouse("<32;3;3", "M")?.button).toBe("left");
    });

    test("bit 64 is the wheel", () => {
        expect(parseSgrMouse("<64;1;1", "M")?.button).toBe("wheel-up");
        expect(parseSgrMouse("<65;1;1", "M")?.button).toBe("wheel-down");
    });

    test("modifier bits are read", () => {
        expect(parseSgrMouse("<28;1;1", "M")?.mods).toEqual({
            shift: true,
            alt: true,
            ctrl: true,
            super: false,
        });
    });

    test("a malformed report is dropped rather than decoded as position 0,0", () => {
        expect(parseSgrMouse("<0;12", "M")).toBeUndefined();
        expect(parseSgrMouse("<;;", "M")).toBeUndefined();
        expect(parseSgrMouse("<0;0;1", "M")).toBeUndefined(); // 1-based, so 0 is invalid
    });
});

describe("parseX10Mouse", () => {
    test("a left press at 1,1 is the origin", () => {
        expect(parseX10Mouse("\x20\x21\x21")).toEqual({
            kind: "mouse",
            action: "press",
            button: "left",
            col: 0,
            row: 0,
            mods: noMods(),
        });
    });

    test("button 3 is a release with no known button", () => {
        const report = parseX10Mouse("\x23\x21\x21");
        expect(report?.action).toBe("release");
        expect(report?.button).toBe("none");
    });

    test("a payload shorter than three code units is dropped", () => {
        expect(parseX10Mouse("\x20\x21")).toBeUndefined();
    });
});
```

Then, in `decode-legacy.test.ts`, the pipeline-level cases — these are the ones that
matter, because they are what a real keystroke stream looks like:

```ts
test("an SGR mouse report decodes to a mouse event, not keys", () => {
    const result = decodeLegacy("\x1b[<0;12;5M", "");
    expect(result.events).toEqual([
        { kind: "mouse", action: "press", button: "left", col: 11, row: 4, mods: noMods() },
    ]);
});

test("an X10 mouse report does not leak its payload as keystrokes", () => {
    // 32+49 = 81 = "Q", which is the quit binding.
    const result = decodeLegacy("\x1b[M\x20\x51\x21", "");
    expect(result.events).toEqual([
        { kind: "mouse", action: "press", button: "left", col: 48, row: 0, mods: noMods() },
    ]);
    expect(result.carry).toBe("");
});

test("a mouse report split across two reads survives the carry", () => {
    const first = decodeLegacy("\x1b[<0;12", "");
    expect(first.events).toEqual([]);
    const second = decodeLegacy(";5M", first.carry);
    expect(second.events).toHaveLength(1);
});

test("an X10 report split before its payload survives the carry", () => {
    const first = decodeLegacy("\x1b[M\x20", "");
    expect(first.events).toEqual([]);
    expect(first.carry).toBe("\x1b[M\x20");
    expect(decodeLegacy("\x51\x21", first.carry).events).toHaveLength(1);
});

test("keys around a mouse report are still decoded, in order", () => {
    const result = decodeLegacy("a\x1b[<0;1;1Mb", "");
    expect(result.events.map((e) => e.kind)).toEqual(["press", "mouse", "press"]);
});
```

And in `decode-kitty.test.ts`, that the delegation still works:

```ts
test("a mouse report inside a kitty stream is decoded", () => {
    const result = decodeKitty("\x1b[97u\x1b[<0;1;1M", "");
    expect(result.events.map((e) => e.kind)).toEqual(["press", "mouse"]);
});
```

Run: `bun test packages/tui/src/input` — red, `./mouse` does not exist.

- [ ] **Step 2: Implement**

`input/mouse.ts`:

```ts
import { noMods, type KeyMods } from "./keys";

type MouseButton = /* as in Shared interfaces */;
interface MouseReport { /* as in Shared interfaces */ }

const WHEEL_BUTTONS: MouseButton[] = ["wheel-up", "wheel-down", "wheel-left", "wheel-right"];
const PLAIN_BUTTONS: MouseButton[] = ["left", "middle", "right", "none"];

function modsFromButton(b: number): KeyMods {
    return { shift: (b & 4) !== 0, alt: (b & 8) !== 0, ctrl: (b & 16) !== 0, super: false };
}

function buttonOf(b: number): MouseButton {
    if ((b & 64) !== 0) return WHEEL_BUTTONS[b & 3] ?? "none";
    return PLAIN_BUTTONS[b & 3] ?? "none";
}

function build(b: number, x: number, y: number, released: boolean): MouseReport | undefined {
    // Coordinates are one-based on the wire. A zero means the report is
    // malformed, and treating it as a click on the origin would move the
    // sidebar selection on a corrupt frame.
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 1 || y < 1) return undefined;
    const motion = (b & 32) !== 0;
    return {
        kind: "mouse",
        action: released ? "release" : motion ? "drag" : "press",
        button: buttonOf(b),
        col: x - 1,
        row: y - 1,
        mods: modsFromButton(b),
    };
}
```

`parseSgrMouse(params, final)` strips the leading `<`, splits on `;`, requires
exactly three numeric fields, and passes `final === "m"` as `released`.

`parseX10Mouse(payload)` requires `payload.length === 3`, takes each code unit minus
32, and passes `(b & 3) === 3 && (b & 64) === 0` as `released` — the release button
value only exists when the report is not a wheel notch. `build` then reports the
button as `"none"`, which `PLAIN_BUTTONS[3]` already gives it.

In `decode-legacy.ts`, inside the `buf[i + 1] === "["` branch, **before** the
existing `isNumericParams` filter:

```ts
if (scan.final === "M" && scan.params === "" && scan.intermediates === "") {
    // The X10 form: three raw payload bytes follow the sequence and are not
    // part of it. Left unconsumed they decode as ordinary characters.
    const payload = buf.slice(i + scan.length, i + scan.length + 3);
    if (payload.length < 3) return { events, carry: buf.slice(i) };
    i += scan.length + 3;
    const report = parseX10Mouse(payload);
    if (report !== undefined) events.push(report);
    continue;
}
if (scan.params.startsWith("<") && (scan.final === "M" || scan.final === "m")) {
    i += scan.length;
    const report = parseSgrMouse(scan.params, scan.final);
    if (report !== undefined) events.push(report);
    continue;
}
```

`DecodeResult.events` becomes `InputEvent[]`; `decode-kitty.ts` changes only the
type of its local `events` array.

**No payload byte can be ESC**, because every one of them is `32 + value`. So
`decodeKitty`'s `nextKittyStart` scan cannot find a false kitty sequence inside an
X10 payload, and the chunk-splitting it does around kitty sequences stays correct.

**Known limitation, recorded here so a later round does not re-derive it:** `index.ts`
reads stdin with `chunk.toString("utf-8")`, so an X10 payload byte above 127 is
decoded as U+FFFD and a valid two-byte UTF-8 pair spanning two payload bytes collapses
into one code unit and desyncs the report. That caps the X10 path at roughly column 95.
It is not worth switching stdin to binary for: the TUI always requests `?1006h`, and
the X10 path exists to keep a non-compliant terminal from injecting garbage keystrokes,
not to be a first-class encoding.

- [ ] **Step 3: Verify**

```bash
bun test packages/tui/src/input
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui
git commit -m "feat(tui): decode SGR and X10 mouse reports"
```

---

### Task 19.2: Turn outer-terminal tracking on and off

**Files:**
- Modify: `packages/tui/src/term/tty.ts`, `packages/tui/src/index.ts`
- Test: `packages/tui/src/term/tty.test.ts` (append), `packages/tui/src/index.test.ts` (append)

**Interfaces:**
- `TtyOptions` gains `mouse: boolean`.

`leaveSequence` already turns all four modes off, so only the enter side is missing.
`enterSequence` gains `?1000h` (press and release) `?1002h` (motion while a button is
held) `?1006h` (SGR encoding), in that order, after the kitty push.

`?1006h` last is deliberate: it changes only how reports are encoded, and a terminal
that does not understand it leaves the tracking modes that precede it enabled rather
than swallowing the whole run.

**`mouse: false` is a real opt-out**, read from `TASKFLOW_TUI_NO_MOUSE` in `index.ts`.
Enabling tracking takes native click-drag text selection away from the user — most
terminals then require Shift or Option to select — and there is no argument parser in
`index.ts` yet to hang a flag off. An env var costs one line and gives anyone whose
terminal misbehaves a way out that does not involve a rebuild.

**`leaveSequence` keeps emitting `MOUSE_OFF` unconditionally**, including when
`mouse` is false. Turning off a mode that was never on is a no-op on every terminal,
and the previous behaviour — which the "restores the terminal" tests already pin —
must not change based on a flag.

- [ ] **Step 1: Write the failing test**

In `tty.test.ts`:

```ts
test("the enter sequence turns mouse tracking on in SGR encoding", () => {
    const out = enterSequence({ kitty: false, mouse: true });
    expect(out).toContain("\x1b[?1000h");
    expect(out).toContain("\x1b[?1002h");
    expect(out).toContain("\x1b[?1006h");
    // SGR encoding is selected after the tracking modes it encodes.
    expect(out.indexOf("\x1b[?1006h")).toBeGreaterThan(out.indexOf("\x1b[?1000h"));
});

test("mouse: false enables no tracking at all", () => {
    const out = enterSequence({ kitty: false, mouse: false });
    expect(out).not.toContain("\x1b[?100");
});

test("the leave sequence turns tracking off even when it was never enabled", () => {
    expect(leaveSequence({ kitty: false, mouse: false })).toContain("\x1b[?1000l");
});

test("everything the enter sequence enables, the leave sequence disables", () => {
    const left = leaveSequence({ kitty: true, mouse: true });
    for (const part of enterSequence({ kitty: true, mouse: true }).split("\x1b[?")) {
        // A DEC private set is `<digits>h`; anything else in the split is not one.
        if (!/^\d+h/.test(part)) continue;
        const mode = part.slice(0, part.indexOf("h"));
        expect(left).toContain(`\x1b[?${mode}l`);
    }
});
```

That last test is the one worth having: it fails the moment someone adds a mode to
the enter side and forgets the restore, which is the failure this package treats as
its worst available outcome. It is written as a split rather than a match because
`no-control-regex` (on, via `eslint.configs.recommended`) bans ESC inside a regex
literal — the same reason `input/csi.ts` scans character codes by hand.

In `index.test.ts`, one end-to-end case in the existing harness style: run the entry
point against the fake backend with `TASKFLOW_TUI_NO_MOUSE=1` and assert the captured
output contains no `\x1b[?1000h`, then without it and assert it does.

- [ ] **Step 2: Implement**

```ts
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";

function enterSequence(opts: TtyOptions): string {
    return `${ALT_SCREEN_ON}${CURSOR_HIDE}${opts.kitty ? KITTY_PUSH : ""}${opts.mouse ? MOUSE_ON : ""}`;
}
```

`index.ts`: `const mouse = process.env.TASKFLOW_TUI_NO_MOUSE === undefined;` and
`new Tty(sink, { kitty: kittyAvailable, mouse })`.

- [ ] **Step 3: Verify**

```bash
bun test packages/tui/src/term/tty.test.ts packages/tui/src/index.test.ts
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui
git commit -m "feat(tui): enable mouse tracking on the outer terminal"
```

---

### Task 19.3: Hoist the layout and hit-test it

**Files:**
- Create: `packages/tui/src/ui/layout.ts`, `packages/tui/src/ui/layout.test.ts`
- Modify: `packages/tui/src/ui/session-pane.ts`, `packages/tui/src/ui/routing.ts`
- Test: `packages/tui/src/ui/session-pane.test.ts` (append), `packages/tui/src/ui/routing.test.ts` (append)

**Interfaces:**
- Produces: `Layout`, `computeLayout(cols, rows, zoomed): Layout`,
  `tabSpans(width: number, tabs: TabSpec[]): Array<{ start: number; end: number }>`,
  `routeMouse(report: MouseReport, layout: Layout, counts: { rows: number; tabs: number }): Action`.
- `Action` gains `{ kind: "select"; index: number }`, `{ kind: "open-tab"; index: number }`,
  `{ kind: "scroll"; delta: number }`, `{ kind: "focus"; target: Focus }`.

**`computeLayout` is the geometry `App.render` computes inline today** — the
`SIDEBAR_WIDTH` clamp, `paneX`, `paneWidth`, and the tab strip owning row 0 with the
pane taking `rows - 1` beneath it. Moving it out is what lets a click be tested
against the same numbers the frame was drawn with.

**It is called fresh on every mouse report rather than stored from the last render.**
Storing it would introduce a frame of staleness between a resize and the next click,
and the inputs (`cols`, `rows`, `zoomed`) are all owned by `App` and free to read.

**`tabSpans` is extracted from `drawTabs`**, which computes exactly these ranges
today and discards them. `drawTabs` is rewritten to consume `tabSpans` so the strip
that is drawn and the strip that is clicked can never disagree — a click landing one
tab to the left of the highlight is precisely the bug that splitting the two would
produce.

**`routeMouse` is pure and knows nothing about sessions.** Whether a report goes to
a child depends on that child's modes, which live in `App`; `routeMouse` answers only
"what does this position mean to the UI".

- [ ] **Step 1: Write the failing test**

`layout.test.ts`:

```ts
describe("computeLayout", () => {
    test("the sidebar is a third of the width, capped at 30", () => {
        expect(computeLayout(120, 40, false).sidebarWidth).toBe(30);
        expect(computeLayout(60, 40, false).sidebarWidth).toBe(20);
    });

    test("zoom removes the sidebar and gives the pane every column", () => {
        const layout = computeLayout(120, 40, true);
        expect(layout.sidebarWidth).toBe(0);
        expect(layout.paneX).toBe(0);
        expect(layout.paneWidth).toBe(120);
    });

    test("the tab strip owns row 0 and the pane the rest", () => {
        const layout = computeLayout(120, 40, false);
        expect(layout.tabRow).toBe(0);
        expect(layout.paneY).toBe(1);
        expect(layout.paneHeight).toBe(39);
    });

    test("a one-row terminal leaves the pane no height rather than a negative one", () => {
        expect(computeLayout(80, 1, false).paneHeight).toBe(0);
    });
});
```

`session-pane.test.ts`:

```ts
test("tabSpans matches the columns drawTabs actually paints", () => {
    const tabs = [
        { label: "one", active: true },
        { label: "two", active: false },
    ];
    const spans = tabSpans(40, tabs);
    const buf = new ScreenBuffer(40, 1);
    drawTabs(buf, 0, 0, 40, tabs);
    // The active tab is the inverse-video run, and it is span 0.
    const inverse = [...Array(40).keys()].filter((x) => (buf.get(x, 0)?.attrs ?? 0) & ATTR_INVERSE);
    expect(inverse[0]).toBe(spans[0]?.start);
    expect(inverse[inverse.length - 1]).toBe((spans[0]?.end ?? 0) - 1);
});

test("a tab that does not fit gets no span", () => {
    expect(tabSpans(4, [{ label: "one", active: true }, { label: "two", active: false }]))
        .toHaveLength(1);
});
```

`routing.test.ts`:

```ts
const layout = computeLayout(100, 30, false);
function at(patch: Partial<MouseReport>): MouseReport {
    return { kind: "mouse", action: "press", button: "left", col: 0, row: 0, mods: noMods(), ...patch };
}

test("a click in the sidebar selects the row under it", () => {
    expect(routeMouse(at({ col: 5, row: 7 }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "select", index: 7 });
});

test("a click past the last row selects nothing", () => {
    expect(routeMouse(at({ col: 5, row: 7 }), layout, { rows: 3, tabs: 0 }))
        .toEqual({ kind: "none" });
});

test("a left drag in the sidebar keeps selecting", () => {
    expect(routeMouse(at({ col: 5, row: 2, action: "drag" }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "select", index: 2 });
});

test("a release in the sidebar does nothing", () => {
    expect(routeMouse(at({ col: 5, row: 2, action: "release" }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "none" });
});

test("the wheel moves the sidebar selection one row", () => {
    expect(routeMouse(at({ col: 5, row: 2, button: "wheel-down" }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "move", delta: 1 });
    expect(routeMouse(at({ col: 5, row: 2, button: "wheel-up" }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "move", delta: -1 });
});

test("a click on a tab opens it and focuses the session", () => {
    expect(routeMouse(at({ col: layout.paneX + 1, row: 0 }), layout, { rows: 20, tabs: 2 }))
        .toEqual({ kind: "open-tab", index: 0 });
});

test("a click past the last tab does nothing", () => {
    expect(routeMouse(at({ col: layout.cols - 1, row: 0 }), layout, { rows: 20, tabs: 1 }))
        .toEqual({ kind: "none" });
});

test("a click in the pane focuses the session", () => {
    expect(routeMouse(at({ col: layout.paneX + 3, row: 5 }), layout, { rows: 20, tabs: 1 }))
        .toEqual({ kind: "focus", target: "session" });
});

test("the wheel in the pane scrolls it", () => {
    expect(routeMouse(at({ col: layout.paneX + 3, row: 5, button: "wheel-up" }), layout, { rows: 20, tabs: 1 }))
        .toEqual({ kind: "scroll", delta: -3 });
});

test("a middle click is unbound everywhere", () => {
    expect(routeMouse(at({ col: 2, row: 2, button: "middle" }), layout, { rows: 20, tabs: 0 }))
        .toEqual({ kind: "none" });
});
```

- [ ] **Step 2: Implement**

`computeLayout` mirrors `App.render`'s arithmetic exactly, with `paneHeight` clamped
at zero. `tabSpans` is `drawTabs`' cursor loop with the `buf.set` calls removed,
returning `{start, end}` per tab that fits; `drawTabs` then iterates the spans.

`routeMouse` dispatches on region, then on button:

```
sidebarWidth > 0 && col < sidebarWidth   → wheel: move ±1
                                          → left press/drag: select row, if row < counts.rows
                                          → otherwise: none
row === layout.tabRow                     → left press on span i, i < counts.tabs: open-tab i
                                          → otherwise: none
inside the pane rect                      → wheel: scroll ∓3
                                          → left press: focus session
                                          → otherwise: none
```

Wheel-left and wheel-right are unbound; they fall to `none`.

- [ ] **Step 3: Verify**

```bash
bun test packages/tui/src/ui
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui
git commit -m "feat(tui): hoist the frame layout and hit-test mouse reports"
```

---

### Task 19.4: Wire the mouse into the app

**Files:**
- Modify: `packages/tui/src/ui/app.ts`, `packages/tui/src/index.ts`, `packages/tui/src/term/session-terminal.ts`
- Test: `packages/tui/src/ui/app.test.ts` (append), `packages/tui/src/term/session-terminal.test.ts` (append)

**Interfaces:**
- `App` gains `handleMouse(report: MouseReport): void`.
- `SessionTerminal` gains `scroll(lines: number): void`.

`index.ts`'s feed loop currently calls `app.handleKey(ev)` for every decoded event.
It becomes a dispatch on `ev.kind === "mouse"`, in both `feed` and `flushHeldEscape`
(`flushCarry` returns keys only, but its return type widens with `DecodeResult`).

`App.handleMouse` computes the layout, asks `routeMouse`, and applies the action.
`select` sets `this.selected` and focus; `open-tab` sets `this.activeSession` and
focus; `focus` sets the focus target; `scroll` calls `SessionTerminal.scroll`.

**`scroll` is a method on `SessionTerminal`, not `app.sessions[i].term.terminal.scrollLines`.**
`terminal` is public, but reaching through it from the UI layer puts xterm's API in
two places, and the scroll has to be paired with nothing else today only because
Stage 1 has no way to open a session — Stage 2 will want it to interact with
`attach()`'s replay.

**Mouse reports do not touch `pendingEscape`.** In legacy mode a bare Escape is held
for 25ms waiting for its pair; a click inside that window is forwarded before the
Escape it followed, which is out of order. This is left alone rather than fixed:
the window is 25ms, the reordering is invisible to every UI binding, and draining
the carry from the mouse path would put escape-timing logic in two places. Recorded
so a review round does not re-derive it as a defect.

- [ ] **Step 1: Write the failing test**

In `app.test.ts`, using the existing frame-reading style — assert against what was
painted, not against internal state:

```ts
test("a click on a sidebar row moves the selection there", () => {
    const app = makeApp(/* store with >4 rows */);
    app.render();
    app.handleMouse({ kind: "mouse", action: "press", button: "left", col: 2, row: 3, mods: noMods() });
    app.render();
    expect(selectedRow(screen)).toBe(3); // the inverse-video row
});

test("a click on a sidebar row also takes focus back from the session", () => {
    const app = makeApp();
    app.handleKey(ctrlEsc); // focus the session
    app.handleMouse(click({ col: 2, row: 1 }));
    expect(app.focus).toBe("sidebar");
});

test("a click past the last row leaves the selection alone", () => { /* ... */ });

test("a click in the pane focuses the session", () => {
    const app = makeApp();
    app.handleMouse(click({ col: 40, row: 5 }));
    expect(app.focus).toBe("session");
});

test("the wheel over the sidebar moves the selection", () => { /* ... */ });
```

In `session-terminal.test.ts`:

```ts
test("scroll moves the viewport and blits the scrolled-back lines", async () => {
    const term = /* attached SessionTerminal, 5 rows, 20 lines written */;
    term.scroll(-3);
    expect(term.terminal.buffer.active.viewportY).toBe(/* baseY - 3 */);
});
```

- [ ] **Step 2: Implement**

`App.handleMouse` is a switch over the `Action` union, sharing the `move`/`select-tab`
clamping already in `handleKey` — extract the two clamps into private helpers rather
than duplicating them, so a click and a keypress can never disagree about the bounds.

`SessionTerminal.scroll(lines)` is `this.terminal.scrollLines(lines)`.

- [ ] **Step 3: Verify**

```bash
bun test packages/tui
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui
git commit -m "feat(tui): bind mouse clicks and the wheel to the UI"
```

---

### Task 19.5: Forward reports to a child that asked for them

**Files:**
- Modify: `packages/tui/src/input/encode.ts`, `packages/tui/src/term/session-terminal.ts`, `packages/tui/src/ui/app.ts`
- Test: `packages/tui/src/input/encode.test.ts` (append), `packages/tui/src/term/session-terminal.test.ts` (append), `packages/tui/src/ui/app.test.ts` (append)

**Interfaces:**
- `ChildModes` gains `mouseTracking` and `mouseEncoding`.
- Produces: `encodeMouseForChild(report: MouseReport, modes: ChildModes): string`.

**The encoding mode has to be tracked by hand.** `IModes` exposes
`mouseTrackingMode` but has no member for the *encoding* — `?1005` (UTF-8),
`?1006` (SGR) and `?1015` (urxvt). `SessionTerminal` already registers
`{ prefix: "?", final: "h" }` and `{ prefix: "?", final: "l" }` handlers to track
DECTCEM; the same two handlers read 1005/1006/1015 and keep a
`mouseEncoding` field. Reset in `attach()` alongside `hiddenCursor`, for the same
reason: `terminal.reset()` clears the child's modes and the tracking must follow it.

**Tracking gates which events; encoding decides the bytes.** They are orthogonal on
the wire and a child can legally combine any pair.

| `mouseTracking` | forwarded |
|---|---|
| `none` | nothing |
| `x10` | press only, **and no modifier bits** — X10 tracking predates them |
| `vt200` | press and release |
| `drag` | press, release, drag |
| `any` | the same as `drag`; bare motion is never generated (see Scope) |

Wheel notches are presses and are forwarded wherever a press is.

| `mouseEncoding` | bytes |
|---|---|
| `sgr` | `CSI < b ; x ; y M`, or `… m` for a release, with `b` naming the real button |
| `urxvt` | `CSI (b+32) ; x ; y M` |
| `utf8` | `CSI M` then `b+32`, `x+32`, `y+32` as code points |
| `x10` | the same, but a coordinate above 223 makes the report undeliverable, so it is dropped |

`b` is rebuilt from the report: button base (left 0, middle 1, right 2, wheel
`64 + index`), plus 32 for a drag, plus the modifier bits — except under `x10`
tracking. Under every non-SGR encoding a release is button value 3.

**Coordinates are pane-relative and one-based.** `App` translates before encoding:
`col - layout.paneX`, `row - layout.paneY`, and the encoder adds one.

**A report outside the child's own grid is dropped, not clamped.** The pane can be
larger than the child's grid for a frame after a resize — `blitTerminal` already
guards against exactly this — and a click on a blank column past the child's width
is not a click on its last column.

- [ ] **Step 1: Write the failing test**

`encode.test.ts`, table-driven over the four encodings plus the gating matrix:

```ts
const press: MouseReport = { kind: "mouse", action: "press", button: "left", col: 11, row: 4, mods: noMods() };

test("a child that never asked for the mouse receives nothing", () => {
    expect(encodeMouseForChild(press, modes({ mouseTracking: "none" }))).toBe("");
});

test("SGR encoding is one-based and keeps the button on release", () => {
    expect(encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "sgr" })))
        .toBe("\x1b[<0;12;5M");
    expect(encodeMouseForChild({ ...press, action: "release", button: "right" },
        modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }))).toBe("\x1b[<2;12;5m");
});

test("X10 encoding offsets by 32 and spells a release as button 3", () => {
    expect(encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "x10" })))
        .toBe("\x1b[M\x20\x2c\x25");
    expect(encodeMouseForChild({ ...press, action: "release" },
        modes({ mouseTracking: "vt200", mouseEncoding: "x10" }))).toBe("\x1b[M\x23\x2c\x25");
});

test("X10 encoding drops a report it cannot express", () => {
    expect(encodeMouseForChild({ ...press, col: 300 },
        modes({ mouseTracking: "vt200", mouseEncoding: "x10" }))).toBe("");
});

test("urxvt encoding is decimal with the offset applied to the button", () => {
    expect(encodeMouseForChild(press, modes({ mouseTracking: "vt200", mouseEncoding: "urxvt" })))
        .toBe("\x1b[32;12;5M");
});

test("vt200 tracking drops a drag but keeps press and release", () => {
    expect(encodeMouseForChild({ ...press, action: "drag" }, modes({ mouseTracking: "vt200" }))).toBe("");
    expect(encodeMouseForChild({ ...press, action: "release" }, modes({ mouseTracking: "vt200" }))).not.toBe("");
});

test("x10 tracking drops release and drag, and reports no modifiers", () => {
    const m = modes({ mouseTracking: "x10", mouseEncoding: "sgr" });
    expect(encodeMouseForChild({ ...press, action: "release" }, m)).toBe("");
    expect(encodeMouseForChild({ ...press, mods: { ...noMods(), ctrl: true } }, m)).toBe("\x1b[<0;12;5M");
});

test("modifier bits ride the button under vt200", () => {
    expect(encodeMouseForChild({ ...press, mods: { ...noMods(), ctrl: true } },
        modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }))).toBe("\x1b[<16;12;5M");
});

test("a drag sets bit 32", () => {
    expect(encodeMouseForChild({ ...press, action: "drag" },
        modes({ mouseTracking: "drag", mouseEncoding: "sgr" }))).toBe("\x1b[<32;12;5M");
});

test("the wheel is a press", () => {
    expect(encodeMouseForChild({ ...press, button: "wheel-up" },
        modes({ mouseTracking: "vt200", mouseEncoding: "sgr" }))).toBe("\x1b[<64;12;5M");
});
```

`session-terminal.test.ts`:

```ts
test("the child's mouse modes are read off its own output", async () => {
    const term = /* SessionTerminal */;
    await write(term, "\x1b[?1002h\x1b[?1006h");
    expect(term.modes.mouseTracking).toBe("drag");
    expect(term.modes.mouseEncoding).toBe("sgr");
    await write(term, "\x1b[?1006l");
    expect(term.modes.mouseEncoding).toBe("x10");
});

test("a re-attach does not carry the old encoding onto a fresh grid", async () => { /* ... */ });
```

`app.test.ts`:

```ts
test("a click in the pane reaches a child that asked for the mouse", () => {
    // fake session with mouseTracking: "vt200"; assert the SESSION_INPUT payload
    // is the pane-relative report, not the screen-absolute one.
});

test("a click in the pane never reaches a child that did not", () => { /* payload count 0 */ });

test("a click past the child's own width is dropped", () => { /* ... */ });
```

- [ ] **Step 2: Implement**

`encodeMouseForChild` is one gating function and one switch over the encoding.
`App.sendToChild` widens from `KeyEvent[]` to `InputEvent[]` and picks
`encodeForChild` or `encodeMouseForChild` per element.

- [ ] **Step 3: Verify**

```bash
bun test packages/tui
bun run lint && bun run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/tui
git commit -m "feat(tui): forward mouse reports to children that requested them"
```

---

### Task 19.6: Manual smoke test — USER GATE

**This step needs a human at a real terminal and must not be run autonomously.**
Stop the loop, report, and wait.

Stage 1 has no way to open a session — `App.sessions` is empty until Stage 2's
`SESSION_CREATE` — so this covers the UI half only. The child-forwarding half is
unit-tested here and first exercised end-to-end in Stage 2, exactly as
`encodeForChild` was built in Task 8 and first used in Task 15.

```bash
cd packages/tui && bun run dev
```

Verify:

1. Clicking a sidebar row moves the highlight to it.
2. Clicking a row past the end of the list changes nothing.
3. The wheel over the sidebar moves the highlight one row per notch.
4. Dragging with the left button held moves the highlight with the pointer.
5. `Q` still quits, and the terminal comes back with the cursor visible, the mouse
   released (click-drag selects text again) and no stray output.
6. `TASKFLOW_TUI_NO_MOUSE=1 bun run dev` — the mouse does nothing, native text
   selection works throughout, and the terminal still restores cleanly on quit.
7. Resize the window, then click a row. It selects the row under the pointer.
   (`index.ts` still does not handle `SIGWINCH` — the parent plan defers that —
   so the frame will be stale; what matters is that the click and the highlight
   agree with each other.)

Record what the user reports in the handoff before continuing.

---

## Review posture

Each of 19.1 – 19.5 gets a gpt-5.5 review round via the `codex-review` skill over its
own base-commit-to-HEAD diff, on the parent flow's one-round-per-session rule.

Carry the parent plan's "Known and accepted" exclusion list into every round, and add
these three, which are decisions rather than defects:

- **`?1003h` is never enabled.** A child in `any` tracking gets press, release and
  drag but no bare motion. Deliberate (see Scope).
- **The X10 decode path is capped near column 95** by stdin's UTF-8 decoding. It
  exists to stop garbage keystrokes on a terminal that ignored `?1006h`, not to be a
  supported encoding.
- **A mouse report does not drain a held Escape** in legacy mode, so a click inside
  the 25ms window is delivered before the Escape it followed.

## What this does not do

- **`SIGWINCH`.** Unchanged from the parent plan: the layout is recomputed per report,
  but `cols`/`rows` are still read once at startup, so a resized window misrenders
  until restart. Clicks and the frame stay consistent with each other because both
  read the same stale numbers.
- **Sidebar scrolling.** `drawSidebar` maps row index to screen row one-to-one, so a
  list longer than the terminal is truncated and its tail is unreachable by mouse or
  keyboard alike. That is a pre-existing gap; when the sidebar gains a scroll offset,
  `routeMouse` gains the same offset and both are tested against it.
- **Mouse inside the help overlay, the filter, or any Stage 2/3 pane.** None exist.
