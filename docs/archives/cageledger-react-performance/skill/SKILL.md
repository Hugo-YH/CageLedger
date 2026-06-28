---
name: cageledger-react-performance-dev
description: Execute and resume the CageLedger React 19, Vite 8, TypeScript and SQLite performance migration. Use for tasks from docs/progress/MASTER.md involving frontend migration, rendering performance, API caching, database indexing, benchmarks, Docker, offline packaging, or release hardening.
---

# CageLedger React Performance Development

## Continuity Protocol

Read `docs/progress/MASTER.md` before every task. This project uses `LOCAL_ONLY` tracking. Read the active phase file, complete the next unchecked task, record telemetry, update its checkbox and the phase count in MASTER immediately.

## S.U.P.E.R Architecture - Mandatory Coding Standard

> Write code like building with LEGO - each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

All code produced in this project MUST conform to these five principles. Violations are treated as bugs.

### S - Single Purpose
- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- **Litmus test**: Can you describe this module's responsibility in a single sentence? If not, split it.

### U - Unidirectional Flow
- Data flows in one direction: input -> processing -> output
- Dependencies point inward: outer layers depend on inner, inner layers know nothing about outer
- No circular imports, no reverse dependencies
- **Litmus test**: Can the core logic run unit tests with zero external services?

### P - Ports over Implementation
- Define interface contracts (JSON Schema, types, data structures) BEFORE writing implementation
- All cross-module I/O must be serializable
- Swapping a data source, render layer, or notification channel requires zero changes to core logic
- **Practice**: Every module boundary communicates via explicit, schema-defined contracts

### E - Environment-Agnostic
- Configuration via environment variables or config files, never hardcoded
- All dependencies explicitly declared
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, and in release packages
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R - Replaceable Parts
- Any layer can be replaced without affecting others
- Replacement cost is the core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: Ask whether a module can be replaced by touching only its directory

## S.U.P.E.R Code Review - Run After Every Task

| # | Check | Principle |
|:--|:------|:----------|
| 1 | Every new module/file has exactly one responsibility | S |
| 2 | No function does more than one conceptual thing | S |
| 3 | Data flows input -> processing -> output | U |
| 4 | No circular imports introduced | U |
| 5 | Cross-module interfaces are TypeScript/contracts | P |
| 6 | Module I/O is serializable | P |
| 7 | No hardcoded paths, URLs, keys, or environment values | E |
| 8 | Dependencies are declared in package.json | E |
| 9 | New modules can be replaced without unrelated changes | R |
| 10 | Relevant checks and tests pass | - |

All pass: proceed. One or two failures: fix before completion. Three or more failures: stop and refactor.

## Target Standards

- Use React 19, TypeScript strict mode, Vite 8, TanStack Query and TanStack Virtual.
- Keep server state in query hooks. Keep transient UI state in local components or a domain reducer.
- Keep business calculations as pure functions under `src/domain/` and test them with Vitest.
- Use stable query keys and invalidate the narrowest affected domain after writes.
- Keep quantity-entry input updates row-local; do not rerender the workspace per keystroke.
- Lazy-load business pages, preview/print code and `jsQR`.
- Preserve API paths, Cookie Session, permissions, database payloads and existing visual semantics.
- Create performance data only in the system temp directory. Never modify `data/` for benchmarks.
- Run `npm run check`; run browser and API regression for interaction, cache, permission, print or export changes.

## Architecture Context

Target flow: `React view -> query/UI state -> typed API -> HTTP -> service -> repository -> SQLite`.

Priority violations:
- `src/app.js` combines state, API, domain, rendering, events and printing.
- Root `innerHTML` replacement makes every state change rebuild the full workspace.
- Intake filters extract hot values from JSON and can force scans or temporary sorts.
- Development, static and shared modes currently split persistence behavior; the target has one API-backed mode.

## Parallel Work

Use the lanes in `docs/plan/task-breakdown.md`. Keep frontend feature work, database work and release work in separate files. Consolidate sequentially and run the full check after merging results.

## Progress And Telemetry

After each task:
1. Record estimated/actual effort, S.U.P.E.R score, unplanned dependencies and drift in MASTER.
2. Update the phase checkbox and MASTER phase count.
3. Evaluate thresholds: annotate at 3, replan at 6, rescope at 8.
4. Stop and replan before the next task when a threshold is reached.

## Archive Trigger

When all 13 tasks are complete, move analysis, plan, progress and this skill into `docs/archives/cageledger-react-performance/`, update `docs/archives/README.md`, and preserve the final telemetry.
