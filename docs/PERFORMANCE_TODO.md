# Performance TODO

## Pending

- Continue shrinking billing data loads: quantity-sheet, workflow, reimbursement ledger, billing statement, and workflow version lists return summary fields only; billing statements now read current version rows directly instead of scanning all workflow payloads. Billing now queries occupancies by month and scope, and the next step is field-level trimming for large statement detail payloads.
- Continue trimming detail payloads: reimbursement detail history now returns ledger summaries instead of full record payloads with IACUC details, and workflow event lists now return display summaries instead of full event payloads.
- Continue replacing full-list refreshes after writes with targeted reloads or optimistic local updates in the frontend, especially around workflow status changes, quantity-sheet-related derived previews, and any remaining admin tables. Intake batch and placement task writes now merge server responses locally instead of reloading both paged lists after each write, and paged list loads now ignore stale responses when users rapidly switch filters or pages.
- Continue reducing permission-filter overhead for room managers: entity list filtering now uses structured room/rack/slot fields instead of assembling the full state for each restricted list response, and placement-task pagination now pushes authorized room filters into SQL.
- Continue reducing repeated audit-log queries: operation-log pagination now uses a short cache and audit writes invalidate the cached pages.
- Reduce full-app DOM rebuild frequency further by splitting heavyweight views into localized rerender zones; current scheduled-render path now batches to animation frames, local state persistence skips unchanged snapshots, and persistence no longer invalidates search/index caches on every write.
