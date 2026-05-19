# Performance TODO

## Pending

- Continue shrinking billing data loads: quantity-sheet and workflow lists are paged, billing now queries occupancies by month and scope, and the next step is field-level trimming for large statement payloads.
- Continue replacing full-list refreshes after writes with targeted reloads or optimistic local updates in the frontend, especially around workflow status changes, quantity-sheet-related derived previews, and any remaining admin tables.
- Reduce full-app DOM rebuild frequency further by splitting heavyweight views into localized rerender zones once the current scheduled-render path is stable.
