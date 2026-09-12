# Performance and accessibility reference

Use CageLedger tokens, accessibility contracts and the requested scope. Read the sections relevant to the affected interaction.

## Rendering cost

Prefer transform and opacity when they can express the change without shifting layout. Size transitions can be appropriate for expanding content; inspect layout, paint and dropped frames under realistic load before replacing them.

Changing inherited CSS variables may enlarge the style-recalculation surface. For a drag, compare a direct transform on the moving element with updates on a shared ancestor. Keep changes based on measured impact.

## Animation APIs

Hardware acceleration depends on the animated property, browser and installed library version. Do not assume that every shorthand is main-thread-only or that every CSS/WAAPI animation is accelerated. Check current source or documentation and profile the actual component when performance is in question.

Use the existing component implementation when it meets the task. CSS transitions, WAAPI and JavaScript springs can each support appropriate workflows; preserve cancellation, cleanup and continuity when changing APIs.

## Reduced motion

Nonessential animation may be disabled completely. Preserve visible loading, success, error and focus states using text, color or static indicators. Opening and closing overlays must work without waiting for an animation or transition end event. Verify both preference settings for affected components.

## Touch and keyboard

Decorative hover motion should be limited to hover-capable fine pointers. Keep focus feedback and keyboard activation available when hover is absent. For touch gestures, validate the actual pointer lifecycle and interrupted interactions; do not add a gesture solely because it is illustrated in a reference.
