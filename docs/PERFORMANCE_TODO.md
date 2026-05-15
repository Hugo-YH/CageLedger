# Performance TODO

## Pending

- Continue shrinking infrastructure payloads: bootstrap now returns summaries, cage view loads per-room details, billing still upgrades to full infrastructure on demand.
- Add short-lived in-process caches for read-heavy data such as IACUC index, principal identities, and bootstrap room/rack/slot snapshots, then invalidate them explicitly after writes.
- Narrow quantity-sheet transfer synchronization to only the affected target sheets instead of scanning every sheet in the month on each save.
- Continue replacing full-list refreshes after writes with targeted reloads or optimistic local updates in the frontend, especially around quantity sheets and workflow detail views.
