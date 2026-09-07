# 动效机会参考

以下频率与参数是评估起点，项目 Token、无障碍要求和实际使用场景优先。只读取相关条目。

## The Gate

Every candidate must survive all four questions, in order. Record the answer — it goes in the report.

### 1. Frequency — how often will a user see this?

| Frequency                                                             | Verdict                                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 100+ times/day (keyboard shortcuts, command palette, core navigation) | **Reject. No animation. Ever.**                                  |
| Tens of times/day (hover states, list navigation, frequent toggles)   | Reject, or suggest only near-imperceptible motion (fast, subtle) |
| Occasional (modals, drawers, toasts, settings)                        | Eligible — standard animation                                    |
| Rare / first-time (onboarding, empty states, success, celebration)    | Eligible — this is where the delight budget lives                |

Keyboard-initiated actions (command palettes, shortcuts, focus jumps) are a disqualifier, not a judgment call — repeated hundreds of times a day, animation makes them feel slow, delayed, and disconnected. Raycast has no open/close animation; that is the optimal experience.

### 2. Purpose — why does this animate?

The answer must be one of these, named explicitly:

- **Feedback** — confirming the interface heard the user (press scale, hold-to-confirm fill)
- **Spatial consistency** — showing where something came from or went (toast enters and exits the same edge; panel grows from its trigger)
- **State indication** — making a state change legible (morphing button, expanding accordion)
- **Preventing a jarring change** — content that teleports, appears, or vanishes with no bridge
- **Explanation** — motion that demonstrates how a feature works (marketing/onboarding only)
- **Delight** — allowed _only_ at the Rare/first-time frequency tier

"It looks cool" is not on this list. If you can't name the purpose in one of these words, reject the candidate.

### 3. Speed — can it stay inside budget?

The suggestion must work within the standard budgets (UI under 300ms):

| Element                  | Duration      |
| ------------------------ | ------------- |
| Press feedback           | 100–160ms     |
| Tooltips, small popovers | 125–200ms     |
| Dropdowns, selects       | 150–250ms     |
| Modals, drawers          | 200–500ms     |
| Marketing / explanatory  | Can be longer |

If the moment only "works" as a slow, showy animation, it fails the gate.

### 4. Function — does motion help or hinder here?

Decoration on functional, information-dense UI hinders. A decorative mouse-tracking effect is fine on a marketing page; on a functional graph in a banking app, no animation is better. Data the user is trying to _read_ or _act on_ should not move for style.

## Where to Hunt

Sweep for these seams — each is a known class of genuine opportunity:

### Feedback gaps

- Pressable elements with no `:active` state → `transform: scale(0.97)` with `transition: transform 160ms ease-out` (subtle: 0.95–0.98)
- Destructive actions confirmed with a plain click where a hold-to-confirm fill would prevent slips → `clip-path: inset(0 100% 0 0)` overlay, 2s linear on press, 200ms ease-out snap-back on release

### Teleporting state

- Content that swaps, appears, or vanishes instantly (conditional renders, route content, expanding sections) → fade/scale entrances from `scale(0.95–0.97)` + `opacity: 0`, `ease-out`, never `scale(0)`; `@starting-style` for entry without JS
- Accordions/collapses that snap open → height + opacity transition
- List items added/removed with no bridge (and the list isn't high-frequency) → enter/exit transitions; CSS transitions, not keyframes, so rapid triggers retarget smoothly

### Missing spatial story

- Panels, popovers, menus that appear with no connection to their trigger → scale in with `transform-origin` at the trigger (Base UI: `var(--transform-origin)`); modals are exempt — they stay centered
- Dismissable surfaces (toasts, sheets) that exit a different way than they entered → symmetric paths; `translateY(100%)` percentages, not hardcoded pixels

### Group entrances

- A grid or list that pops in all at once on a page users see occasionally → 30–80ms stagger; decorative, must never block interaction

### Gesture seams

- Draggable/swipeable elements that snap with no physics → springs (`{ type: "spring", duration: 0.5, bounce: 0.2 }`, bounce 0.1–0.3), velocity-based dismissal (`Math.abs(distance)/elapsedMs > ~0.11`), rubber-banding at boundaries instead of hard stops

### The delight budget

- Rare, high-emotion moments rendered flat — first-run, empty states, success/completion, celebration. These are the only places bounce, stagger generosity, or a longer beat are welcome.

Useful sweeps: grep for conditional renders with no transition (`{isOpen &&`, `display: none` toggles), `onClick` handlers on elements with no `:active`/transition styles, `details`/accordion markup, drag handlers, `.map(` renders of entering lists, empty-state and success components.
