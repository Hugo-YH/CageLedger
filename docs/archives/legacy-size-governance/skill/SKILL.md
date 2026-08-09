---
name: legacy-size-governance
description: Safely reduce server_app/legacy.py and extract compatibility responsibilities into focused modules. Use when legacy.py exceeds architecture size limits, when moving HTTP parsing or route helpers into server_app/web, or when preserving server.py compatibility exports during backend modularization.
---

# Legacy Size Governance

Read `docs/progress/MASTER.md` before work. This task uses `LOCAL_ONLY`: select the next unchecked task, update its phase file and MASTER after verification, then archive the workflow when all tasks are complete.

## S.U.P.E.R Architecture — Mandatory Coding Standard

> Write code like building with LEGO — each brick has a single job, a standard interface, a clear direction, runs anywhere, and can be swapped at will.

All code produced in this project MUST conform to these five principles. Violations are treated as bugs.

### S — Single Purpose

- Each module, file, and function solves exactly one problem
- Prefer decomposition; power comes from composition
- **Litmus test**: Can you describe this module's responsibility in a single sentence? If not, split it.

### U — Unidirectional Flow

- Data flows in one direction: input → processing → output
- Dependencies point inward: outer layers depend on inner, inner layers know nothing about outer
- No circular imports, no reverse dependencies
- **Litmus test**: Can the core logic run unit tests with zero external services?

### P — Ports over Implementation

- Define interface contracts (JSON Schema, types, data structures) BEFORE writing implementation
- All cross-module I/O must be serializable
- Swapping a data source, render layer, or notification channel requires zero changes to core logic
- **Practice**: Every module boundary communicates via explicit, schema-defined contracts

### E — Environment-Agnostic

- Configuration via environment variables or config files, never hardcoded
- All dependencies explicitly declared (requirements.txt / package.json / Cargo.toml)
- Processes are stateless; persistence delegated to external storage
- Logs to stdout. Same codebase runs locally, in Docker, on cloud
- **Config precedence**: Environment variables > .env > config file > in-code defaults

### R — Replaceable Parts

- Any layer can be replaced without affecting others
- Replacement cost is THE core metric of architecture quality
- If replacing one component triggers cascading changes, the architecture is broken
- **Validation**: For each module, ask "Can I swap this with a different implementation by only touching this module's directory?"

## Execution Rules

- Keep `server_app.legacy.initialize_schema` and `server.py` compatibility exports stable.
- Keep URL matching order, status codes, error payloads, authorization checks and public payload keys stable.
- Let `server_app/web/` depend on standard library and domain/repository modules. Avoid imports from `server_app.legacy`.
- Put pure HTTP parsing in `server_app/web/`; pass request data as explicit function parameters.
- Add focused Python unit tests for every extracted contract before extending route extractions.
- Run `npm run check`, `npm run smoke:api`, and `git diff --check` after backend extraction.

## Current Target Architecture

`server.py` remains the compatibility entry point. `legacy.py` stays a composition and compatibility layer. Focused web modules own route-adjacent parsing. Domain services own business rules. Repositories own SQLite access.

Current hotspots: `legacy.py` combines schema migration, state compatibility, billing composition and HTTP routing. Begin with isolated parsing functions. Treat schema initialization and `CageLedgerHandler` route ordering as high-risk follow-up work.

## S.U.P.E.R Code Review — Run After Every Task

Before marking any task as complete, verify ALL of the following:

| # | Check | Principle | Pass? |
|:--|:------|:----------|:------|
| 1 | Every new module/file has exactly one responsibility | S | |
| 2 | No function does more than one conceptual thing | S | |
| 3 | Data flows input → processing → output, no reverse deps | U | |
| 4 | No circular imports introduced | U | |
| 5 | Cross-module interfaces are schema-defined (types/contracts) | P | |
| 6 | Module I/O is serializable | P | |
| 7 | No hardcoded paths, URLs, keys, or config values | E | |
| 8 | All new dependencies explicitly declared in dependency file | E | |
| 9 | New modules can be replaced without changes to other modules | R | |
| 10 | All tests pass after the change | — | |

**Scoring**: All pass = ✅ proceed. 1-2 fail = fix before marking complete. 3+ fail = stop and refactor.

## Progress and Telemetry

After each task, update the phase checkbox, MASTER phase count and current status. Append actual effort, 10-point S.U.P.E.R score, unplanned dependency count and task drift to MASTER's telemetry table. Apply the adaptive thresholds recorded in MASTER before beginning a subsequent task. Archive `docs/analysis/legacy-size-refactor-*`, `docs/plan/legacy-size-refactor-*`, `docs/progress/` and this skill into `docs/archives/legacy-size-governance/` after all tasks complete.
