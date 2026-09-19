# Animation Standards Reference

These are reference heuristics, not repository gates. Use the project's existing tokens and accessibility contracts; confirm user impact before reporting a defect. Example durations, curves and library behavior need to fit the current implementation. Read only the relevant sections.

Design examples informed by Emil Kowalski. Findings need observed impact; use repository tokens for target values.

## Should it animate? (frequency table)

| Frequency                                                   | Decision                     |
| ----------------------------------------------------------- | ---------------------------- |
| 100+ times/day (keyboard shortcuts, command palette toggle) | Prefer immediate feedback.   |
| Tens of times/day (hover effects, list navigation)          | Remove or drastically reduce |
| Occasional (modals, drawers, toasts)                        | Standard animation           |
| Rare / first-time (onboarding, feedback, celebrations)      | Can add delight              |

For frequent keyboard actions, check input latency and focus continuity. Brief feedback is acceptable when it does not delay the operation.

Valid purposes for motion: spatial consistency, state indication, explanation, feedback, preventing jarring change. "It looks cool" on a frequently-seen element is not valid.

## Easing

Decision order:

- Entering or exiting → **`ease-out`** (starts fast, feels responsive)
- Moving / morphing on screen → **`ease-in-out`**
- Hover / color change → **`ease`**
- Constant motion (marquee, progress) → **`linear`**
- Default → **`ease-out`**

Check whether slow-start easing delays visible feedback; the easing name alone is not a defect.

Use existing component curves first. Examples for a task that actually needs a custom curve:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1); /* strong ease-out for UI */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* strong ease-in-out for on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* iOS-like drawer curve (Ionic) */
```

Find curves at [easing.dev](https://easing.dev/) or [easings.co](https://easings.co/) — don't hand-roll from scratch.

## Duration

| Element                  | Duration      |
| ------------------------ | ------------- |
| Button press feedback    | 100–160ms     |
| Tooltips, small popovers | 125–200ms     |
| Dropdowns, selects       | 150–250ms     |
| Modals, drawers          | 200–500ms     |
| Marketing / explanatory  | Can be longer |

These ranges are examples, not a duration gate. Use the project motion contract and check perceived delay; do not speed up spinners merely to suggest faster loading.

## Physicality

- Large scale entrances can be abrupt. Consider a small scale change, a fade or no motion according to the component.
- **Origin-aware popovers.** Scale from the trigger, not center:

  ```css
  .popover {
    transform-origin: var(--transform-origin);
  } /* Base UI */
  ```

  **Modals are exempt** — they appear centered in the viewport, keep `transform-origin: center`.

- **Button press feedback.** `transform: scale(0.97)` on `:active`, `transition: transform 160ms ease-out`. Subtle (0.95–0.98). Optional when the component already has adequate press feedback.

## Springs

Feel natural because they simulate physics; no fixed duration — they settle on parameters. Use for: drag with momentum, "alive" elements (Dynamic Island), interruptible gestures, decorative mouse-tracking.

```js

// Apple-style (easier to reason about) — recommended
{ type: "spring", duration: 0.5, bounce: 0.2 }

// Traditional physics (more control)
{ type: "spring", mass: 1, stiffness: 100, damping: 10 }

```

Keep bounce subtle (0.1–0.3); avoid bounce in most UI — reserve for drag-to-dismiss and playful interactions. A spring that preserves position and velocity while retargeting can help gestures users may reverse mid-motion; confirm that behavior in the current implementation.

Mouse interactions: interpolate with `useSpring` rather than tying value directly to mouse position (direct = artificial, no momentum). Only do this when the motion is decorative.

## Interruptibility

CSS **transitions** can retarget an in-progress property change. A fixed-start keyframe animation may jump if cancelled and restarted. For rapid toast updates or toggles, assess cancellation and continuity from the visible state before recommending an API change.

```css
/* Retargetable property transition */
.toast {
  transition: transform 400ms ease;
}

/* Fixed-start entry; check continuity when rapidly toggled */
@keyframes slideIn {
  from {
    transform: translateY(100%);
  }
  to {
    transform: translateY(0);
  }
}
```

Use `@starting-style` for entry without JS:

```css
.toast {
  opacity: 1;
  transform: translateY(0);
  transition:
    opacity 400ms ease,
    transform 400ms ease;
  @starting-style {
    opacity: 0;
    transform: translateY(100%);
  }
}
```

Legacy fallback: `useEffect(() => setMounted(true), [])` + `data-mounted` attribute.

## Asymmetric timing

Slow where the user is deciding, fast where the system responds.

```css
.overlay {
  transition: clip-path 200ms ease-out;
} /* release: fast */
.button:active .overlay {
  transition: clip-path 2s linear;
} /* press: slow, deliberate */
```

## Performance

Prefer transform and opacity where they fit the interaction; inspect layout and paint when animating size. Hardware acceleration depends on the property, browser and installed animation-library version. Verify current behavior before recommending different APIs or dependencies.

Parent CSS-variable updates and broad transitions are useful profiling candidates, not automatic defects. CSS, WAAPI and JavaScript each have valid uses; assess the actual long tasks, dropped frames and cancellation behavior under realistic load.

## Transforms & clip-path

- **`translate` percentages** are relative to the element's own size — `translateY(100%)` moves by the element's height regardless of dimensions (how Sonner/Vaul position toasts/drawers). Prefer over hardcoded px.
- **`scale()` scales children too** (font, icons, content) — a feature for press feedback.
- **3D**: `rotateX/Y` + `transform-style: preserve-3d` for depth/orbit/flip without JS.
- **`clip-path: inset(t r b l)`** is a powerful animation tool: each value eats in from that side. Uses: reveal-on-scroll (`inset(0 0 100% 0)` → `inset(0 0 0 0)`), hold-to-delete overlay, seamless tab color transitions (duplicate + clip the active copy), comparison sliders.

## Gestures & drag

- **Momentum dismissal**: don't require crossing a distance threshold — compute velocity (`Math.abs(distance)/elapsedMs`); dismiss if `> ~0.11`. A flick should be enough.
- **Damping at boundaries**: dragging past a natural edge moves less the further you go (real things slow before stopping).
- **Pointer capture** once dragging starts, so it continues when the pointer leaves bounds.
- **Multi-touch protection**: ignore extra touch points after the drag begins (`if (isDragging) return`) — prevents jumps.
- **Friction over hard stops** — allow over-drag with rising resistance rather than an invisible wall.

## Masking imperfect crossfades

When a crossfade shows two overlapping states despite tuning easing/duration, add subtle `filter: blur(2px)` during the transition to blend them into one perceived transformation. Keep blur < 20px (heavy blur is expensive, especially Safari).

## Stagger

If stagger addresses an observed need, keep the delay brief. It is optional decoration and must not block interaction.

```css
.item {
  opacity: 0;
  transform: translateY(8px);
  animation: fadeIn 300ms ease-out forwards;
}
.item:nth-child(2) {
  animation-delay: 50ms;
}
.item:nth-child(3) {
  animation-delay: 100ms;
}
@keyframes fadeIn {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

## Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .element {
    animation: fade 0.2s ease;
  } /* keep opacity/color, drop transform-based motion */
}
@media (hover: hover) and (pointer: fine) {
  .element:hover {
    transform: scale(1.05);
  } /* gate hover motion — touch fires false hovers on tap */
}
```

```jsx
const reduce = useReducedMotion();
const closedX = reduce ? 0 : "-100%";
```

Reduced motion may disable nonessential animation entirely. Preserve visible state and focus feedback; opening, closing and input must not depend on animation completion events.

## Debugging (recommend in reviews when feel is uncertain)

- **Slow motion**: bump duration 2–5× or use DevTools animation inspector. Check colors crossfade cleanly, easing doesn't stop abruptly, `transform-origin` is right, coordinated properties stay in sync.
- **Frame-by-frame**: Chrome DevTools Animations panel reveals timing drift between coordinated properties.
- **Available browser or device environments** for gesture lifecycle and interruption checks. Use physical hardware when available to resolve uncertain feel or browser-specific behavior, and report remaining verification limits.
- **Independent review** can help when the result remains uncertain; do not delay an otherwise validated delivery until the next day.

## Cohesion

Match motion to the component's personality: playful can be bouncier; a professional dashboard should be crisp and fast. Sonner feels right partly because easing, duration, design, and even the name are in harmony — slightly slower, `ease` rather than `ease-out`, to feel elegant. Opacity + height in entering/exiting lists is trial and error; there's no formula — adjust until it feels right.
