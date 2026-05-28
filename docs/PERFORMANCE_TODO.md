# Performance TODO

## Pending

- Continue shrinking billing data loads: quantity-sheet, workflow, reimbursement ledger, billing statement, and workflow version lists return summary fields only; billing now queries occupancies by month and scope, and the next step is field-level trimming for large statement detail payloads.
- Continue replacing full-list refreshes after writes with targeted reloads or optimistic local updates in the frontend, especially around workflow status changes, quantity-sheet-related derived previews, and any remaining admin tables.
- Reduce full-app DOM rebuild frequency further by splitting heavyweight views into localized rerender zones; current scheduled-render path now batches to animation frames, local state persistence skips unchanged snapshots, and persistence no longer invalidates search/index caches on every write.
